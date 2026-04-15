import ky from "ky";
import { Octokit } from "octokit";
import { NonRetriableError } from "inngest";

import { convex } from "@/lib/convex-client";
import { inngest } from "@/inngest/client";

import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
import build from "next/dist/build";
import { th } from "date-fns/locale";

interface ExportToGithubEvent {
    projectId: Id<"projects">;
    repoName: string;
    visibility: "public" | "private";
    description?: string;
    githubToken: string;
};

type FileWithUrl = Doc<"files"> & {
    storageUrl: string | null;
};

export const exportToGithub = inngest.createFunction(
    {
        id: "export-to-github",
        cancelOn: [
            {
                event: "github/export.cancel",
                if: "event.data.projectId == async.data.projectId"
            },
        ],
        onFailure: async ({ event, step }) => {
            const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY;
            if (!internalKey) return;

            const { projectId } = event.data.event.data as ExportToGithubEvent;

            await step.run("set-failed-status", async () => {
                await convex.mutation(api.system.updateExportStatus, {
                    internalKey,
                    projectId,
                    status: "failed",
                });
            });
        }
    },
    {
        event: "github/export.repo",
    },
    async ({ event, step }) => {
        const {
            projectId,
            repoName,
            visibility,
            description,
            githubToken,
        } = event.data as ExportToGithubEvent;

        const internalKey = process.env.POLARIS_CONVEX_INTERNAL_KEY;
        if (!internalKey) {
            throw new NonRetriableError("POLARIS_CONVEX_INTERNAL_KEY is not configured");
        };

        // Set status to "exporting" immediately for better UX
        await step.run("set-exporting-status", async () => {
            await convex.mutation(api.system.updateExportStatus, {
                internalKey,
                projectId,
                status: "exporting",
            });
        });

        const octokit = new Octokit({ auth: githubToken });

        // Get authenticated user
        const { data: user } = await step.run("gat-github-user", async () => {
            return await octokit.rest.users.getAuthenticated();
        });

        // Create the new repository with auto_init to have initial commit
        const { data: repo } = await step.run("create-repo", async () => {
            return await octokit.rest.repos.createForAuthenticatedUser({
                name: repoName,
                description: description || "Exported from Polaris",
                private: visibility === "private",
                auto_init: true,
            });
        });

        // Wait for Github to initialize the repo (auto_init creates the repo but it may not be immediately ready for git operations)
        await step.sleep("wait-for-repo-init", "3s");

        // Get the initial commit's tree SHA (the auto_init creates a commit with an empty tree)
        const initialCommitSha = await step.run("get-initial-commit", async () => {
            const { data: ref } = await octokit.rest.git.getRef({
                owner: user.login,
                repo: repo.name,
                ref: "heads/main",
            });
            return ref.object.sha;
        });

        // Fetch all project files with their storage URLs
        const files = await step.run("fetch-project-files", async () => {
            return await convex.query(api.system.getProjectFilesWithUrls, {
                internalKey,
                projectId,
            }) as FileWithUrl[];
        });

        // Build a map of file IDs to their full paths
        const buildFilePaths = (files: FileWithUrl[]) => {
            const fileMap = new Map<Id<"files">, FileWithUrl>();
            files.forEach(f => fileMap.set(f._id, f));

            const getFullPath = (file: FileWithUrl): string => {
                if (!file.parentId) {
                    return file.name;
                }

                const parent = fileMap.get(file.parentId);

                if (!parent) {
                    return file.name;
                }

                return `${getFullPath(parent)}/${file.name}`;
            };

            const paths: Record<string, FileWithUrl> = {};
            files.forEach(file => {
                paths[getFullPath(file)] = file;
            });

            return paths;
        };

        const filePaths = buildFilePaths(files);

        // Filter to only actual files (exclude folders) and prepare for upload
        const fileEntries = Object.entries(filePaths).filter(
            ([, file]) => file.type === "file"
        );

        if (fileEntries.length === 0) {
            throw new NonRetriableError("No files to export");
        }

        // Create blobs for all files in parallel
        const treeItems = await step.run("create-blobs", async () => {
            const items: {
                path: string;
                mode: "100644";
                type: "blob";
                sha: string;
            }[] = [];

            for (const [path, file] of fileEntries) {
                let content: string;
                let encoding: "utf-8" | "base64" = "utf-8";

                if (file.content != undefined) {
                    // Text file
                    content = file.content;
                } else if (file.storageUrl) {
                    // Binary file - fetch the content and encode as base64
                    const response = await ky.get(file.storageUrl);
                    const buffer = Buffer.from(await response.arrayBuffer());
                    content = buffer.toString("base64");
                    encoding = "base64";
                } else {
                    // File has no content and no storage URL - skip it
                    continue;
                }

                const { data: blob } = await octokit.rest.git.createBlob({
                    owner: user.login,
                    repo: repoName,
                    content,
                    encoding,
                });

                items.push({
                    path,
                    mode: "100644",
                    type: "blob",
                    sha: blob.sha,
                });
            }

            return items;
        });

        if (treeItems.length === 0) {
            throw new NonRetriableError("Failed to create blobs for files");
        }

        // Create a new tree with all the blobs
        const { data: tree } = await step.run("create-tree", async () => {
            return await octokit.rest.git.createTree({
                owner: user.login,
                repo: repoName,
                tree: treeItems,
            });
        });

        // Create a new commit referencing the new tree and the initial commit as its parent
        const { data: commit } = await step.run("create-commit", async () => {
            return await octokit.rest.git.createCommit({
                owner: user.login,
                repo: repoName,
                message: "Export project from Polaris",
                tree: tree.sha,
                parents: [initialCommitSha],
            });
        });

        // Update the reference of the main branch to point to the new commit
        await step.run("update-branch-ref", async () => {
            return await octokit.rest.git.updateRef({
                owner: user.login,
                repo: repoName,
                ref: "heads/main",
                sha: commit.sha,
                force: true,
            });
        });

        // Set status to completed with the repo URL for better UX
        await step.run("set-completed-status", async () => {
            await convex.mutation(api.system.updateExportStatus, {
                internalKey,
                projectId,
                status: "completed",
                repoUrl: repo.html_url,
            });
        });

        return {
            success: true,
            repoUrl: repo.html_url,
            filesExported: treeItems.length,
        };
    }
);