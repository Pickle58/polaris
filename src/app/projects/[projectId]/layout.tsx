import { ProjectIdLayout } from "@/features/projects/components/project-id-layout";
import { Id } from "../../../../convex/_generated/dataModel";

const Layout = async ({
    children,
    params,
}: {
    children: React.ReactNode
    params: Promise<{ projectId: string }>
}) => {
    const { projectId } = await params;
    const brandedProjectId = projectId as Id<"projects">;

    return (
        <ProjectIdLayout
            projectId={projectId as Id<"projects">}>
            {children}
        </ProjectIdLayout>
    )
}

export default Layout