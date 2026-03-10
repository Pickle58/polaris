import { inngest } from "@/inngest/client";
import { firecrawl } from "@/lib/firecrawl";
import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";

const URL_REGEX = /https?:\/\/[^\s]+/g;

const MODEL_CANDIDATES = Array.from(
  new Set(
    [
      process.env.ANTHROPIC_MODEL,
      "claude-sonnet-4-6",
      "claude-3-7-sonnet-latest",
      "claude-3-5-sonnet-latest",
      "claude-3-5-haiku-latest",
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-3-haiku-20240307",
    ].filter((model): model is string => Boolean(model))
  )
);

export const demoGenerate = inngest.createFunction(
  { id: "demo-generate" },
  { event: "demo/generate" },
  async ({ event, step }) => {
    const { prompt } = event.data as { prompt: string };

    const urls = await step.run("extact-urls", async () => {
      return prompt.match(URL_REGEX) ?? [];
    }) as string[];

    const scrapedContent = await step.run("scrape=urls", async () => {
      const results = await Promise.all(
        urls.map(async (url) => {
          const result = await firecrawl.scrape(
            url,
            { formats: ["markdown"] },
          );
          return result.markdown ?? null;
        })
      );
      return results.filter(Boolean).join("\n\n");
    });

    const finalPrompt = scrapedContent 
    ? `Context:\n${scrapedContent}\n\nQuestion: ${prompt}` 
    : prompt;

    const text = await step.run("generate-text", async () => {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error("Missing ANTHROPIC_API_KEY");
      }

      let lastError: unknown = null;
      const tried: string[] = [];

      for (const modelId of MODEL_CANDIDATES) {
        tried.push(`anthropic:${modelId}`);

        try {
          const generated = await generateText({
            model: anthropic(modelId),
            prompt: finalPrompt,
          });

          return generated.text;
        } catch (error) {
          lastError = error;
        }
      }

      const statusCode = (lastError as { statusCode?: number })?.statusCode;
      const responseBody = (lastError as { responseBody?: string })?.responseBody;

      throw new Error(
        `No configured Anthropic model is available. Models tried: ${tried.join(
          ", "
        )}. Last error status: ${String(statusCode)}. Last error body: ${String(
          responseBody ?? lastError
        )}`
      );
    });

    return {
      eventName: event.name,
      text,
    };
  }
);