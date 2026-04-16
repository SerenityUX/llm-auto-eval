import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const {
    apiKey: rawKey,
    useCase,
    refinement,
    currentScenarios,
  } = await req.json();
  const apiKey = (rawKey ?? "").trim();

  if (!apiKey || (!useCase && !refinement)) {
    return NextResponse.json(
      { error: "Missing API key or use case description." },
      { status: 400 }
    );
  }

  const isRefinement = !!refinement && Array.isArray(currentScenarios);

  const userMessage = isRefinement
    ? `You have these existing test prompts:
${(currentScenarios as string[]).map((p, i) => `${i + 1}. ${p}`).join("\n")}

Apply this change request: "${refinement}"

Keep prompts short and task-specific (1–2 sentences). Return exactly 5 prompts.
Return ONLY a JSON array (no other text):
[{"prompt":"..."},{"prompt":"..."},{"prompt":"..."},{"prompt":"..."},{"prompt":"..."}]`
    : `Use case: "${useCase}"

Generate exactly 5 SHORT, task-specific prompts (1–2 sentences max) that would be sent to this AI. Each must test a DIFFERENT capability so model quality differences become obvious:

1. A nuanced "why" or "explain the difference between X and Y" question requiring precise understanding
2. A structured-output task (e.g. create a list, quiz questions, or a comparison table)
3. A misconception or edge case — something a user commonly gets wrong
4. A creative or open-ended generation task
5. A practical step-by-step help request

Keep prompts realistic and direct — phrased as a real user would type them.

Return ONLY this JSON (no other text):
[{"prompt":"..."},{"prompt":"..."},{"prompt":"..."},{"prompt":"..."},{"prompt":"..."}]`;

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://llmeval.app",
      "X-Title": "LLM Eval",
    },
    body: JSON.stringify({
      model: "openai/gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You generate concise, targeted prompts for blind LLM evaluation. Output only valid JSON — no markdown, no code fences, no explanation.",
        },
        { role: "user", content: userMessage },
      ],
      temperature: 0.85,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    return NextResponse.json(
      { error: `OpenRouter error (${resp.status}): ${body}` },
      { status: resp.status }
    );
  }

  const data = await resp.json();
  const content: string = data.choices?.[0]?.message?.content ?? "";

  try {
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) throw new Error("No JSON array in response");
    const scenarios = JSON.parse(match[0]) as { prompt: string }[];
    return NextResponse.json({ scenarios });
  } catch {
    return NextResponse.json(
      { error: "Failed to parse scenarios from model response", raw: content },
      { status: 500 }
    );
  }
}
