"use client";

import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";

/* ─── Types ──────────────────────────────────────────────────────────────────── */

type WizardStep =
  | "intro"
  | "apikey"
  | "usecase"
  | "scenarios"
  | "models"
  | "running"
  | "rating"
  | "results";

interface Scenario {
  id: string;
  prompt: string;
}

interface ORouterModel {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt: string; completion: string };
}

interface RunResult {
  modelId: string;
  scenarioId: string;
  content: string;
  error?: string;
  elapsedMs?: number;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

interface BlindResponse {
  letter: string;
  modelId: string;
  content: string;
  rating: number | null;
  elapsedMs?: number;
  usage?: { prompt_tokens: number; completion_tokens: number };
}

interface BlindItem {
  scenario: Scenario;
  responses: BlindResponse[];
}

/* ─── Constants ──────────────────────────────────────────────────────────────── */

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

const PRESET_MODELS: ORouterModel[] = [
  { id: "anthropic/claude-3.5-sonnet", name: "Claude 3.5 Sonnet" },
  { id: "openai/gpt-4o", name: "GPT-4o" },
  { id: "google/gemini-2.0-flash-001", name: "Gemini 2.0 Flash" },
  { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
];

const DEFAULT_SELECTED = PRESET_MODELS.map((m) => m.id);

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ─── Small components ───────────────────────────────────────────────────────── */

function Stars({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (n: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const active = hover ?? value ?? 0;
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          onClick={() => onChange(n)}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(null)}
          className="text-xl leading-none focus:outline-none transition-colors"
          aria-label={`${n} star${n !== 1 ? "s" : ""}`}
        >
          <span style={{ color: n <= active ? "#111" : "#ddd" }}>★</span>
        </button>
      ))}
    </div>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div
      style={{
        height: 2,
        background: "#e5e5e5",
        borderRadius: 9999,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: `${pct}%`,
          background: "#111",
          transition: "width 0.3s ease",
          borderRadius: 9999,
        }}
      />
    </div>
  );
}

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 48 }}>
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 2,
            flex: 1,
            borderRadius: 9999,
            background: i < current ? "#111" : "#e5e5e5",
            transition: "background 0.3s",
          }}
        />
      ))}
    </div>
  );
}

/* ─── Main ───────────────────────────────────────────────────────────────────── */

export default function Home() {
  const [step, setStep] = useState<WizardStep>("intro");
  const [apiKey, setApiKey] = useState("");
  const [useCase, setUseCase] = useState("");
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [scenarioError, setScenarioError] = useState("");
  const [loadingScenarios, setLoadingScenarios] = useState(false);
  const [availableModels, setAvailableModels] =
    useState<ORouterModel[]>(PRESET_MODELS);
  const [selectedIds, setSelectedIds] = useState<string[]>(DEFAULT_SELECTED);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const [runProgress, setRunProgress] = useState({ done: 0, total: 0 });
  const [blindItems, setBlindItems] = useState<BlindItem[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [runError, setRunError] = useState("");
  const [refinement, setRefinement] = useState("");
  const [loadingRefinement, setLoadingRefinement] = useState(false);

  /* ─── Helpers ───────────────────────────────────────────────────────────── */

  const goTo = useCallback((s: WizardStep) => {
    window.scrollTo({ top: 0, behavior: "instant" });
    setStep(s);
  }, []);

  const modelName = (id: string) =>
    availableModels.find((m) => m.id === id)?.name ?? id;

  const formatCost = (
    modelId: string,
    usage?: { prompt_tokens: number; completion_tokens: number }
  ): string | null => {
    if (!usage) return null;
    const model = availableModels.find((m) => m.id === modelId);
    if (!model?.pricing) return null;
    const cost =
      parseFloat(model.pricing.prompt) * usage.prompt_tokens +
      parseFloat(model.pricing.completion) * usage.completion_tokens;
    if (cost === 0) return null;
    return cost < 0.0001 ? `<$0.0001` : `$${cost.toFixed(4)}`;
  };

  const stepNum: Record<WizardStep, number> = {
    intro: 0,
    apikey: 1,
    usecase: 2,
    scenarios: 3,
    models: 4,
    running: 5,
    rating: 6,
    results: 7,
  };

  /* ─── Actions ────────────────────────────────────────────────────────────── */

  const fetchModels = useCallback(async (key: string) => {
    setLoadingModels(true);
    try {
      const res = await fetch("/api/fetch-models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      const data = await res.json();
      if (res.ok && data.models?.length) {
        setAvailableModels(data.models);
        setSelectedIds((prev) => {
          const ids = new Set(
            (data.models as ORouterModel[]).map((m) => m.id)
          );
          const kept = prev.filter((id) => ids.has(id));
          return kept.length
            ? kept
            : DEFAULT_SELECTED.filter((id) => ids.has(id));
        });
      }
    } catch {
      // keep preset defaults on network error
    } finally {
      setLoadingModels(false);
    }
  }, []);

  const generateScenarios = useCallback(async () => {
    setLoadingScenarios(true);
    setScenarioError("");
    try {
      const res = await fetch("/api/generate-scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, useCase }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Unknown error");
      const list: Scenario[] = (
        data.scenarios as { prompt: string }[]
      ).map((s, i) => ({ id: String(i + 1), prompt: s.prompt }));
      setScenarios(list);
      goTo("scenarios");
    } catch (e: unknown) {
      setScenarioError(
        e instanceof Error ? e.message : "Something went wrong."
      );
    } finally {
      setLoadingScenarios(false);
    }
  }, [apiKey, useCase, goTo]);

  const refineScenarios = useCallback(
    async (request: string) => {
      setLoadingRefinement(true);
      setScenarioError("");
      try {
        const res = await fetch("/api/generate-scenarios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey,
            useCase,
            refinement: request,
            currentScenarios: scenarios.map((s) => s.prompt),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Unknown error");
        const list: Scenario[] = (
          data.scenarios as { prompt: string }[]
        ).map((s, i) => ({ id: String(i + 1), prompt: s.prompt }));
        setScenarios(list);
        setRefinement("");
      } catch (e: unknown) {
        setScenarioError(
          e instanceof Error ? e.message : "Something went wrong."
        );
      } finally {
        setLoadingRefinement(false);
      }
    },
    [apiKey, useCase, scenarios]
  );

  const runEval = useCallback(async () => {
    goTo("running");
    setRunError("");
    const validScenarios = scenarios.filter((s) => s.prompt.trim());
    const total = selectedIds.length * validScenarios.length;
    setRunProgress({ done: 0, total });

    const TIMEOUT_MS = 55_000;

    const fetchWithTimeout = (modelId: string, scenario: Scenario): Promise<RunResult> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      return fetch("/api/run-eval", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, modelId, prompt: scenario.prompt }),
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((data): RunResult => {
          clearTimeout(timer);
          setRunProgress((p) => ({ ...p, done: p.done + 1 }));
          return {
            modelId,
            scenarioId: scenario.id,
            content: data.content ?? "",
            error: data.error,
            elapsedMs: data.elapsedMs,
            usage: data.usage,
          };
        })
        .catch((err): RunResult => {
          clearTimeout(timer);
          setRunProgress((p) => ({ ...p, done: p.done + 1 }));
          const isTimeout = err instanceof Error && err.name === "AbortError";
          return {
            modelId,
            scenarioId: scenario.id,
            content: "",
            error: isTimeout ? "Request timed out." : String(err),
          };
        });
    };

    const tasks = selectedIds.flatMap((modelId) =>
      validScenarios.map((scenario) => fetchWithTimeout(modelId, scenario))
    );

    const results: RunResult[] = await Promise.all(tasks);

    // Build blind items: one per scenario, model order shuffled
    const items: BlindItem[] = validScenarios.map((scenario) => {
      const shuffled = shuffle(selectedIds).map((modelId, i) => {
        const hit = results.find(
          (r) => r.modelId === modelId && r.scenarioId === scenario.id
        );
        return {
          letter: LETTERS[i],
          modelId,
          content: hit?.content || hit?.error || "No response received.",
          rating: null as number | null,
          elapsedMs: hit?.elapsedMs,
          usage: hit?.usage,
        };
      });
      return { scenario, responses: shuffled };
    });

    setBlindItems(items);
    setCurrentIdx(0);
    goTo("rating");
  }, [apiKey, selectedIds, scenarios, goTo]);

  const updateRating = useCallback(
    (letter: string, rating: number) => {
      setBlindItems((prev) =>
        prev.map((item, i) => {
          if (i !== currentIdx) return item;
          return {
            ...item,
            responses: item.responses.map((r) =>
              r.letter === letter ? { ...r, rating } : r
            ),
          };
        })
      );
    },
    [currentIdx]
  );

  const computeResults = () => {
    const scores: Record<string, number[]> = {};
    for (const item of blindItems) {
      for (const r of item.responses) {
        if (r.rating !== null) {
          if (!scores[r.modelId]) scores[r.modelId] = [];
          scores[r.modelId].push(r.rating);
        }
      }
    }
    return selectedIds
      .map((id) => {
        const s = scores[id] ?? [];
        const avg = s.length ? s.reduce((a, b) => a + b, 0) / s.length : 0;
        return { id, avg, count: s.length };
      })
      .sort((a, b) => b.avg - a.avg);
  };

  const handleRestart = () => {
    goTo("intro");
    setApiKey("");
    setUseCase("");
    setScenarios([]);
    setScenarioError("");
    setSelectedIds(DEFAULT_SELECTED);
    setAvailableModels(PRESET_MODELS);
    setRunProgress({ done: 0, total: 0 });
    setBlindItems([]);
    setCurrentIdx(0);
    setRevealed(false);
    setRunError("");
    setModelSearch("");
    setLoadingModels(false);
  };

  /* ─── Render ─────────────────────────────────────────────────────────────── */

  const wrap: React.CSSProperties = {
    maxWidth: 680,
    margin: "0 auto",
    paddingTop: 64,
    paddingBottom: 80,
    paddingLeft: 24,
    paddingRight: 24,
  };

  const btn = (active: boolean): React.CSSProperties => ({
    background: active ? "#111" : "#ccc",
    color: "#fff",
    border: "none",
    padding: "12px 24px",
    fontSize: 14,
    fontWeight: 500,
    cursor: active ? "pointer" : "not-allowed",
    letterSpacing: "0.01em",
  });

  // ── Intro ──────────────────────────────────────────────────────────────────
  if (step === "intro") {
    return (
      <main style={wrap}>
        <p
          style={{
            fontSize: 11,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "#999",
            marginBottom: 20,
          }}
        >
          LLM Eval
        </p>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            marginBottom: 24,
            lineHeight: 1.25,
          }}
        >
          Find the best AI model
          <br />
          for what you&apos;re building.
        </h1>
        <p style={{ color: "#555", lineHeight: 1.75, marginBottom: 14, fontSize: 15 }}>
          Benchmarks measure what researchers care about. This measures what
          you care about. Describe your use case and we&apos;ll generate realistic
          test prompts — the kind your application would actually send to a
          model.
        </p>
        <p style={{ color: "#555", lineHeight: 1.75, marginBottom: 14, fontSize: 15 }}>
          Then we run those prompts across multiple models simultaneously. You
          rate the responses blind — no model names, no anchoring bias. Just
          which answer is actually better.
        </p>
        <p style={{ color: "#555", lineHeight: 1.75, marginBottom: 40, fontSize: 15 }}>
          At the end you get a clear ranking: the model that performs best for
          your specific product, judged by you on your own criteria.
        </p>
        <button
          onClick={() => goTo("apikey")}
          style={btn(true)}
        >
          Get started →
        </button>
      </main>
    );
  }

  const totalDots = 6;
  const dotStep = stepNum[step] - 1;

  // ── API Key ────────────────────────────────────────────────────────────────
  if (step === "apikey") {
    return (
      <main style={wrap}>
        <StepDots current={dotStep} total={totalDots} />
        <h2 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em", marginBottom: 8 }}>
          Connect OpenRouter
        </h2>
        <p style={{ color: "#666", fontSize: 14, lineHeight: 1.65, marginBottom: 28 }}>
          We use{" "}
          <a
            href="https://openrouter.ai"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#111", textDecoration: "underline" }}
          >
            OpenRouter
          </a>{" "}
          to access every major model from one API. Your key is used only
          during this session and is never stored anywhere.
        </p>

        <div
          style={{
            background: "#f9f9f9",
            border: "1px solid #e8e8e8",
            padding: "16px 20px",
            marginBottom: 24,
            fontSize: 14,
          }}
        >
          <p style={{ fontWeight: 500, marginBottom: 10 }}>How to get your key</p>
          <ol style={{ paddingLeft: 18, color: "#555", lineHeight: 2.1, margin: 0 }}>
            <li>
              Visit{" "}
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#111", textDecoration: "underline" }}
              >
                openrouter.ai/keys
              </a>
            </li>
            <li>Sign in or create a free account</li>
            <li>
              Click <strong>Create key</strong>, give it a name, and copy it
            </li>
            <li>Add a small credit balance ($1–5 covers a lot of testing)</li>
          </ol>
        </div>

        <label
          style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6 }}
        >
          Your API key
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && apiKey.trim()) {
              goTo("usecase");
              fetchModels(apiKey.trim());
            }
          }}
          placeholder="sk-or-v1-..."
          style={{
            display: "block",
            width: "100%",
            border: "1px solid #ddd",
            padding: "10px 12px",
            fontSize: 13,
            fontFamily: "monospace",
            outline: "none",
            marginBottom: 6,
          }}
          autoFocus
        />
        <p style={{ fontSize: 12, color: "#aaa", marginBottom: 32 }}>
          Never stored. Lives only in this browser tab and disappears when you close it.
        </p>

        <button
          onClick={() => {
            goTo("usecase");
            fetchModels(apiKey.trim());
          }}
          disabled={!apiKey.trim()}
          style={btn(!!apiKey.trim())}
        >
          Continue →
        </button>
      </main>
    );
  }

  // ── Use Case ───────────────────────────────────────────────────────────────
  if (step === "usecase") {
    const canProceed = useCase.trim().length > 0 && !loadingScenarios;
    return (
      <main style={wrap}>
        <StepDots current={dotStep} total={totalDots} />
        <h2 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em", marginBottom: 8 }}>
          What is your AI being used for?
        </h2>
        <p style={{ color: "#666", fontSize: 14, lineHeight: 1.65, marginBottom: 24 }}>
          Describe the purpose in plain language. The more specific, the more
          realistic the test prompts will be.
        </p>
        <textarea
          value={useCase}
          onChange={(e) => setUseCase(e.target.value)}
          placeholder="e.g. An AI tutor that helps high school students understand biology concepts and work through practice problems"
          rows={4}
          style={{
            display: "block",
            width: "100%",
            border: "1px solid #ddd",
            padding: "10px 12px",
            fontSize: 14,
            lineHeight: 1.6,
            outline: "none",
            resize: "vertical",
            fontFamily: "inherit",
          }}
          autoFocus
        />
        {scenarioError && (
          <p style={{ color: "#c00", fontSize: 13, marginTop: 10 }}>{scenarioError}</p>
        )}
        <button
          onClick={generateScenarios}
          disabled={!canProceed}
          style={{ ...btn(canProceed), marginTop: 20 }}
        >
          {loadingScenarios ? "Generating prompts…" : "Generate test prompts →"}
        </button>
      </main>
    );
  }

  // ── Scenarios ──────────────────────────────────────────────────────────────
  if (step === "scenarios") {
    const valid = scenarios.filter((s) => s.prompt.trim());
    return (
      <main style={wrap}>
        <StepDots current={dotStep} total={totalDots} />
        <h2 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em", marginBottom: 8 }}>
          Your test prompts
        </h2>
        <p style={{ color: "#666", fontSize: 14, lineHeight: 1.65, marginBottom: 24 }}>
          These are the prompts we&apos;ll send to each model. Edit, delete, or add your
          own.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
          {scenarios.map((s, i) => (
            <div
              key={s.id}
              style={{ display: "flex", alignItems: "flex-start", gap: 10 }}
            >
              <span
                style={{
                  fontFamily: "monospace",
                  fontSize: 12,
                  color: "#bbb",
                  paddingTop: 11,
                  minWidth: 20,
                  textAlign: "right",
                  flexShrink: 0,
                }}
              >
                {i + 1}.
              </span>
              <textarea
                value={s.prompt}
                onChange={(e) =>
                  setScenarios((prev) =>
                    prev.map((p) =>
                      p.id === s.id ? { ...p, prompt: e.target.value } : p
                    )
                  )
                }
                rows={2}
                style={{
                  flex: 1,
                  border: "1px solid #e5e5e5",
                  padding: "8px 10px",
                  fontSize: 13,
                  lineHeight: 1.5,
                  outline: "none",
                  resize: "vertical",
                  fontFamily: "inherit",
                }}
              />
              <button
                onClick={() =>
                  setScenarios((prev) => prev.filter((p) => p.id !== s.id))
                }
                style={{
                  background: "none",
                  border: "none",
                  fontSize: 20,
                  color: "#ccc",
                  cursor: "pointer",
                  paddingTop: 8,
                  lineHeight: 1,
                  flexShrink: 0,
                }}
                aria-label="Remove prompt"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <button
          onClick={() =>
            setScenarios((prev) => [
              ...prev,
              { id: Date.now().toString(), prompt: "" },
            ])
          }
          style={{
            display: "block",
            width: "100%",
            background: "none",
            border: "1px dashed #ddd",
            padding: "10px",
            fontSize: 13,
            color: "#999",
            cursor: "pointer",
            marginBottom: 32,
          }}
        >
          + Add a prompt
        </button>

        {/* Refinement */}
        <div
          style={{
            borderTop: "1px solid #f0f0f0",
            paddingTop: 24,
            marginBottom: 28,
          }}
        >
          <p
            style={{
              fontSize: 13,
              fontWeight: 500,
              marginBottom: 8,
              color: "#555",
            }}
          >
            Request changes
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <textarea
              value={refinement}
              onChange={(e) => setRefinement(e.target.value)}
              placeholder='e.g. "Make them shorter" or "Add a coding question" or "Focus on edge cases"'
              rows={2}
              style={{
                flex: 1,
                border: "1px solid #ddd",
                padding: "8px 10px",
                fontSize: 13,
                lineHeight: 1.5,
                outline: "none",
                resize: "none",
                fontFamily: "inherit",
                color: "#333",
              }}
            />
            <button
              onClick={() => refineScenarios(refinement)}
              disabled={!refinement.trim() || loadingRefinement}
              style={{
                background:
                  refinement.trim() && !loadingRefinement ? "#111" : "#ccc",
                color: "#fff",
                border: "none",
                padding: "9px 16px",
                fontSize: 13,
                fontWeight: 500,
                cursor:
                  refinement.trim() && !loadingRefinement
                    ? "pointer"
                    : "not-allowed",
                whiteSpace: "nowrap",
              }}
            >
              {loadingRefinement ? "Updating…" : "Regenerate"}
            </button>
          </div>
          {scenarioError && (
            <p style={{ color: "#c00", fontSize: 12, marginTop: 8 }}>
              {scenarioError}
            </p>
          )}
        </div>

        <button
          onClick={() => goTo("models")}
          disabled={valid.length === 0}
          style={btn(valid.length > 0)}
        >
          Choose models →
        </button>
      </main>
    );
  }

  // ── Models ─────────────────────────────────────────────────────────────────
  if (step === "models") {
    const filtered = availableModels
      .filter(
        (m) =>
          !selectedIds.includes(m.id) &&
          (m.name.toLowerCase().includes(modelSearch.toLowerCase()) ||
            m.id.toLowerCase().includes(modelSearch.toLowerCase()))
      )
      .slice(0, 30);

    return (
      <main style={wrap}>
        <StepDots current={dotStep} total={totalDots} />
        <h2 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em", marginBottom: 8 }}>
          Which models should compete?
        </h2>
        <p style={{ color: "#666", fontSize: 14, lineHeight: 1.65, marginBottom: 24 }}>
          We&apos;ve pre-selected four strong general-purpose models. Add or remove freely.
          {loadingModels && (
            <span style={{ color: "#bbb" }}> Loading full catalogue…</span>
          )}
        </p>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
          {selectedIds.map((id) => (
            <div
              key={id}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                border: "1.5px solid #111",
                padding: "5px 10px",
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              {modelName(id)}
              <button
                onClick={() =>
                  setSelectedIds((prev) => prev.filter((m) => m !== id))
                }
                style={{
                  background: "none",
                  border: "none",
                  fontSize: 15,
                  color: "#aaa",
                  cursor: "pointer",
                  lineHeight: 1,
                  padding: 0,
                }}
                aria-label={`Remove ${modelName(id)}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        <div style={{ position: "relative", marginBottom: 32 }}>
          <input
            type="text"
            value={modelSearch}
            onChange={(e) => setModelSearch(e.target.value)}
            placeholder="Search to add more models…"
            style={{
              display: "block",
              width: "100%",
              border: "1px solid #ddd",
              padding: "10px 12px",
              fontSize: 13,
              outline: "none",
              fontFamily: "inherit",
            }}
          />
          {modelSearch && filtered.length > 0 && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                border: "1px solid #ddd",
                borderTop: "none",
                background: "#fff",
                maxHeight: 240,
                overflowY: "auto",
                zIndex: 10,
              }}
            >
              {filtered.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    setSelectedIds((prev) => [...prev, m.id]);
                    setModelSearch("");
                  }}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    padding: "10px 12px",
                    fontSize: 13,
                    background: "none",
                    border: "none",
                    borderBottom: "1px solid #f0f0f0",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.background =
                      "#f9f9f9";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.background = "none";
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{m.name}</span>
                  <span style={{ color: "#bbb", marginLeft: 8, fontSize: 11 }}>
                    {m.id}
                  </span>
                </button>
              ))}
            </div>
          )}
          {modelSearch && filtered.length === 0 && !loadingModels && (
            <div
              style={{
                position: "absolute",
                top: "100%",
                left: 0,
                right: 0,
                border: "1px solid #ddd",
                borderTop: "none",
                background: "#fff",
                padding: "10px 12px",
                fontSize: 13,
                color: "#aaa",
              }}
            >
              No models found
            </div>
          )}
        </div>

        <button
          onClick={runEval}
          disabled={selectedIds.length < 2}
          style={btn(selectedIds.length >= 2)}
        >
          Run evaluation →
        </button>
        {selectedIds.length < 2 && (
          <p style={{ fontSize: 12, color: "#aaa", marginTop: 8 }}>
            Select at least 2 models to compare.
          </p>
        )}
      </main>
    );
  }

  // ── Running ────────────────────────────────────────────────────────────────
  if (step === "running") {
    return (
      <main style={{ ...wrap, textAlign: "center", paddingTop: 120 }}>
        <p style={{ fontSize: 17, fontWeight: 500, marginBottom: 10 }}>
          Running evaluation…
        </p>
        <p style={{ color: "#888", fontSize: 14, marginBottom: 32 }}>
          {runProgress.done} of {runProgress.total} responses collected
        </p>
        <div style={{ maxWidth: 320, margin: "0 auto 16px" }}>
          <ProgressBar done={runProgress.done} total={runProgress.total} />
        </div>
        <p style={{ fontSize: 12, color: "#bbb" }}>
          {selectedIds.length} models ×{" "}
          {scenarios.filter((s) => s.prompt.trim()).length} prompts, running in
          parallel
        </p>
        {runError && (
          <p style={{ color: "#c00", fontSize: 13, marginTop: 24 }}>{runError}</p>
        )}
      </main>
    );
  }

  // ── Rating ─────────────────────────────────────────────────────────────────
  if (step === "rating" && blindItems.length > 0) {
    const item = blindItems[currentIdx];
    const allRated = item.responses.every((r) => r.rating !== null);

    return (
      <main style={wrap}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 40,
          }}
        >
          <h2
            style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.01em" }}
          >
            Rate the responses
          </h2>
          <span style={{ fontSize: 13, color: "#aaa" }}>
            {currentIdx + 1} / {blindItems.length}
          </span>
        </div>

        <div
          style={{
            background: "#f9f9f9",
            border: "1px solid #e8e8e8",
            padding: "14px 16px",
            marginBottom: 24,
          }}
        >
          <p
            style={{
              fontSize: 11,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "#bbb",
              marginBottom: 8,
            }}
          >
            Prompt
          </p>
          <p style={{ fontSize: 14, lineHeight: 1.65 }}>
            {item.scenario.prompt}
          </p>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            marginBottom: 32,
          }}
        >
          {item.responses.map((resp) => (
            <div
              key={resp.letter}
              style={{
                border: "1px solid",
                borderColor: resp.rating !== null ? "#111" : "#e5e5e5",
                padding: "16px",
                transition: "border-color 0.2s",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    fontFamily: "monospace",
                  }}
                >
                  Response {resp.letter}
                </span>
                <Stars
                  value={resp.rating}
                  onChange={(n) => updateRating(resp.letter, n)}
                />
              </div>
              <div className="prose-response">
                <ReactMarkdown>{resp.content}</ReactMarkdown>
              </div>
              {(resp.elapsedMs !== undefined || resp.usage) && (
                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 8,
                    borderTop: "1px solid #f0f0f0",
                    display: "flex",
                    gap: 12,
                    fontSize: 11,
                    color: "#bbb",
                    fontFamily: "monospace",
                  }}
                >
                  {resp.elapsedMs !== undefined && (
                    <span>{(resp.elapsedMs / 1000).toFixed(1)}s</span>
                  )}
                  {(() => {
                    const c = formatCost(resp.modelId, resp.usage);
                    return c ? <span>{c}</span> : null;
                  })()}
                </div>
              )}
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          {currentIdx > 0 ? (
            <button
              onClick={() => {
                window.scrollTo({ top: 0, behavior: "instant" });
                setCurrentIdx((i) => i - 1);
              }}
              style={{
                background: "none",
                border: "none",
                fontSize: 14,
                color: "#888",
                cursor: "pointer",
                padding: 0,
              }}
            >
              ← Previous
            </button>
          ) : (
            <span />
          )}

          {currentIdx < blindItems.length - 1 ? (
            <button
              onClick={() => {
                window.scrollTo({ top: 0, behavior: "instant" });
                setCurrentIdx((i) => i + 1);
              }}
              disabled={!allRated}
              style={btn(allRated)}
            >
              Next prompt →
            </button>
          ) : (
            <button
              onClick={() => {
                setRevealed(false);
                goTo("results");
              }}
              disabled={!allRated}
              style={btn(allRated)}
            >
              See results →
            </button>
          )}
        </div>

        {!allRated && (
          <p
            style={{
              fontSize: 12,
              color: "#aaa",
              marginTop: 12,
              textAlign: "right",
            }}
          >
            Rate all responses to continue.
          </p>
        )}
      </main>
    );
  }

  // ── Results ────────────────────────────────────────────────────────────────
  if (step === "results") {
    const results = computeResults();
    const medals = ["1st", "2nd", "3rd"];
    const winner = results[0];

    return (
      <main style={wrap}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 32,
          }}
        >
          <div>
            <h2
              style={{
                fontSize: 20,
                fontWeight: 600,
                letterSpacing: "-0.01em",
                marginBottom: 6,
              }}
            >
              Results
            </h2>
            {revealed && winner && (
              <p style={{ fontSize: 14, color: "#555" }}>
                <strong>{modelName(winner.id)}</strong> performed best for your
                use case.
              </p>
            )}
            {!revealed && (
              <p style={{ fontSize: 14, color: "#888" }}>
                Model names are hidden until you&apos;re ready.
              </p>
            )}
          </div>
          <button
            onClick={handleRestart}
            style={{
              background: "none",
              border: "none",
              fontSize: 13,
              color: "#aaa",
              cursor: "pointer",
              padding: 0,
            }}
          >
            Start over
          </button>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 16,
            marginBottom: 32,
          }}
        >
          {results.map((r, i) => (
            <div
              key={r.id}
              style={{ display: "flex", alignItems: "center", gap: 16 }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: i === 0 ? "#111" : "#bbb",
                  minWidth: 28,
                  textAlign: "right",
                  letterSpacing: "0.03em",
                  flexShrink: 0,
                }}
              >
                {medals[i] ?? `#${i + 1}`}
              </span>
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 6,
                  }}
                >
                  {revealed ? (
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: i === 0 ? 600 : 400,
                      }}
                    >
                      {modelName(r.id)}
                    </span>
                  ) : (
                    <span
                      style={{
                        fontSize: 13,
                        color: "#ddd",
                        letterSpacing: "0.06em",
                        fontFamily: "monospace",
                      }}
                    >
                      ████████████
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: 13,
                      fontFamily: "monospace",
                      color: i === 0 ? "#111" : "#999",
                    }}
                  >
                    {r.avg.toFixed(1)} / 5
                  </span>
                </div>
                <div
                  style={{
                    background: "#f0f0f0",
                    height: 3,
                    borderRadius: 9999,
                  }}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${(r.avg / 5) * 100}%`,
                      background: i === 0 ? "#111" : "#ccc",
                      borderRadius: 9999,
                      transition: "width 0.6s ease",
                    }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        {!revealed && (
          <button
            onClick={() => setRevealed(true)}
            style={{
              display: "block",
              width: "100%",
              border: "1.5px solid #111",
              background: "none",
              padding: "12px",
              fontSize: 14,
              fontWeight: 500,
              cursor: "pointer",
              marginBottom: 32,
              letterSpacing: "0.01em",
            }}
          >
            Reveal model names
          </button>
        )}

        {revealed && (
          <div
            style={{
              borderTop: "1px solid #f0f0f0",
              paddingTop: 32,
              marginTop: 8,
            }}
          >
            <p
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: "#bbb",
                marginBottom: 28,
              }}
            >
              Per-prompt breakdown
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
              {blindItems.map((item, pi) => (
                <div key={item.scenario.id}>
                  <p
                    style={{
                      fontSize: 12,
                      color: "#999",
                      marginBottom: 10,
                      lineHeight: 1.5,
                    }}
                  >
                    <strong style={{ color: "#555" }}>Prompt {pi + 1}:</strong>{" "}
                    {item.scenario.prompt.length > 110
                      ? item.scenario.prompt.slice(0, 110) + "…"
                      : item.scenario.prompt}
                  </p>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 6 }}
                  >
                    {[...item.responses]
                      .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
                      .map((resp) => (
                        <div
                          key={resp.modelId}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            fontSize: 13,
                          }}
                        >
                          <span style={{ color: "#444" }}>
                            {modelName(resp.modelId)}
                          </span>
                          <span
                            style={{
                              fontFamily: "monospace",
                              color: "#999",
                              fontSize: 12,
                            }}
                          >
                            {"★".repeat(resp.rating ?? 0)}
                            {"☆".repeat(5 - (resp.rating ?? 0))}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    );
  }

  return null;
}
