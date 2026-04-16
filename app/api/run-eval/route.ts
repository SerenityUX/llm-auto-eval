import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { apiKey: rawKey, modelId, prompt } = await req.json();
  const apiKey = (rawKey ?? "").trim();

  if (!apiKey || !modelId || !prompt) {
    return NextResponse.json(
      { error: "Missing apiKey, modelId, or prompt" },
      { status: 400 }
    );
  }

  const start = Date.now();

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://llmeval.app",
      "X-Title": "LLM Eval",
    },
    body: JSON.stringify({
      model: modelId,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
    }),
  });

  const elapsedMs = Date.now() - start;

  if (!resp.ok) {
    const body = await resp.text();
    return NextResponse.json(
      { error: `Model error (${resp.status}): ${body}`, elapsedMs },
      { status: 200 } // always 200 so the eval run continues
    );
  }

  const data = await resp.json();
  const content: string =
    data.choices?.[0]?.message?.content ?? data.error?.message ?? "No response";

  const usage: { prompt_tokens: number; completion_tokens: number } | undefined =
    data.usage
      ? {
          prompt_tokens: data.usage.prompt_tokens ?? 0,
          completion_tokens: data.usage.completion_tokens ?? 0,
        }
      : undefined;

  return NextResponse.json({ content, elapsedMs, usage });
}
