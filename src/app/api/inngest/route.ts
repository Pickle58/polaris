import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { demoError, demoGenerate } from "@/inngest/functions";
import { processMessage } from "@/features/conversations/inngest/process-message";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    demoGenerate, // <-- This is where you'll always add all your functions
    demoError,
    processMessage,
  ],
});