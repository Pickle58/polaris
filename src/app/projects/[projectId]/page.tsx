const ProjectIdPage = async ({
    params,
}: {
    params: Promise<{ projectId: string }>
}) => {
    const { projectId } = await params;

    return (
        <div>
            Project ID: {projectId}
        </div>
    )
}

export default ProjectIdPage;