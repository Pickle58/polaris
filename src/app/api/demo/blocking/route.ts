import { anthropic } from "@ai-sdk/anthropic";
import { generateText } from "ai";
import { NextResponse } from "next/server";

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



export async function POST() {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error: "Missing ANTHROPIC_API_KEY",
      },
      { status: 500 }
    );
  }

  let lastError: unknown = null;
  const tried: string[] = [];

  for (const modelId of MODEL_CANDIDATES) {
    tried.push(`anthropic:${modelId}`);

    try {
      const response = await generateText({
        model: anthropic(modelId),
        prompt: "Write a vegetarian lasagna recipe for 4 people.",
        experimental_telemetry: {
          isEnabled: true,
          recordInputs: true,
          recordOutputs: true,
        },
      });

      return NextResponse.json({ provider: "anthropic", model: modelId, response });
    } catch (error) {
      lastError = error;
    }
  }

  return NextResponse.json(
    {
      error:
        "No configured Anthropic model is available. Set ANTHROPIC_MODEL to a model enabled for your account.",
      modelsTried: tried,
      statusCode: (lastError as { statusCode?: number })?.statusCode,
      responseBody: (lastError as { responseBody?: string })?.responseBody,
      details: String(lastError),
    },
    { status: 500 }
  );
}