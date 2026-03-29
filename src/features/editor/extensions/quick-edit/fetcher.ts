import ky from "ky"
import { z } from "zod"
import { toast } from "sonner";

const editRequestSchema = z.object({
    selectedCode: z.string(),
    fullCode: z.string(),
    instruction: z.string(),
    
});

const editResponseSchema = z.object({
    editedCode: z.string(),
});

type EditRequest = z.infer<typeof editRequestSchema>;
type EditResponse = z.infer<typeof editResponseSchema>;

export const fetcher = async (
    payload: EditRequest,
    signal: AbortSignal,
): Promise<string | null> => {
    try {
        const validatedPayload = editRequestSchema.parse(payload);

        const response = await ky
        .post("/api/quick-edit", {
            json: validatedPayload,
            signal,
            timeout: 30_000,
            retry: 0, // no retries - we want to fail fast if there's an issue
        })
        .json<EditResponse>();

        const validatedResponse = editResponseSchema.parse(response);

        return validatedResponse.editedCode || null;
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
            return null; // Request was aborted, return null suggestion
        }
        toast.error("Failed to AI quick-edit.");
        return null; // On any error, return null suggestion
    }
};