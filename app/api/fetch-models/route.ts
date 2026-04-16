import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("Authorization")?.replace("Bearer ", "").trim();

  if (!apiKey) {
    return NextResponse.json({ error: "Missing API key" }, { status: 401 });
  }

  const resp = await fetch("https://openrouter.ai/api/v1/models", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://llmeval.app",
      "X-Title": "LLM Eval",
    },
  });

  if (!resp.ok) {
    return NextResponse.json(
      { error: `OpenRouter error: ${resp.status}` },
      { status: resp.status }
    );
  }

  const data = await resp.json();

  const models = (
    data.data as {
      id: string;
      name: string;
      description?: string;
      context_length?: number;
      architecture?: { modality?: string };
      pricing?: { prompt: string; completion: string };
    }[]
  )
    .filter((m) => {
      const modality = m.architecture?.modality ?? "";
      return !modality.includes("image->") && m.name && m.id;
    })
    .map((m) => ({
      id: m.id,
      name: m.name,
      description: m.description,
      context_length: m.context_length,
      pricing: m.pricing,
    }))
    .sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0));

  return NextResponse.json({ models });
}
