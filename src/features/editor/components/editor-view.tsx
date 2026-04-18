import Image from "next/image";
import { useEffect, useRef } from "react";

import { useFile, useUpdateFile } from "@/features/projects/hooks/use-files";
import { TopNavigation } from "./top-navigation";
import { Id } from "../../../../convex/_generated/dataModel";
import { useEditor } from "../hooks/use-editor";
import { FileBreadcrumbs } from "./file-breadcrumbs";
import { CodeEditor } from "./code-editor";
import { AlertTriangleIcon } from "lucide-react";

const DEBOUNCE_MS = 1500;

export const EditorView = ({ projectId }: { projectId: Id<"projects"> }) => {
    const { activeTabId } = useEditor(projectId);
    const activeFile = useFile(activeTabId);
    const updateFile = useUpdateFile();
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    const isActiveFileBinary = activeFile && activeFile.storageId;
    const isActiveFileText = activeFile && !activeFile.storageId;

   // Cleanup pending debounced updates when active file changes or component unmounts
    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, [activeTabId]);

    return (
        <div className="h-full flex flex-col">
            <div className="flex items-center">
                <TopNavigation projectId={projectId} />
            </div>
            {activeTabId && <FileBreadcrumbs projectId={projectId} />}
            <div className="flex-1 min-h-0 bg-background">
                {!activeFile && (
                    <div className="size-full flex items-center justify-center">
                        <Image
                            src="/logo-alt.svg"
                            alt="Polaris"
                            width={50}
                            height={50}
                            className="opacity-25"
                        />
                    </div>
                )}
                {isActiveFileText && (
                    <CodeEditor
                        key={activeFile._id}
                        fileName={activeFile.name}
                        initialValue={activeFile.content}
                        onChange={(content: string) => {
                            if (timeoutRef.current) {
                                clearTimeout(timeoutRef.current);
                            }

                            timeoutRef.current = setTimeout(() => {
                                updateFile({ id: activeFile._id, content });
                            }, DEBOUNCE_MS);
                        }}
                    />
                )}
                {isActiveFileBinary && (
                   <div className="size-full flex items-center justify-center">
                        <div className="flex flex-col items-center gap-2.5 max-w-md text-center">
                            <AlertTriangleIcon className="size-10 text-yellow-500" />
                            <p className="text-sm">
                                Binary files are not supported in the editor. Please download the file to view its contents.
                            </p>
                        </div>
                   </div>
                )}
            </div>
        </div>
    );
};