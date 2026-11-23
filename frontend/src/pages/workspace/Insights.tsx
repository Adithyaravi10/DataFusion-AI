import { AlertTriangle, Coins, Cpu, RefreshCw, Send, ShieldCheck, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge, Button, ErrorPanel, Skeleton, StepHeader } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { fmtDateTime, fmtInt } from "../../lib/format";
import { useToast } from "../../lib/toast";
import type { AIInsightsResult, AIProviderStatus, AIUsageRecord, AIUsageSummary } from "../../lib/types";

const PROVIDER_LABELS: Record<string, string> = {
  groq: "Groq",
  gemini: "Google Gemini",
  openrouter: "OpenRouter",
};

function providerLabel(name: string): string {
  return PROVIDER_LABELS[name] ?? name;
}

/** Minimal Markdown rendering for headings, lists, bold text and pipe tables. */
function inline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((piece, index) => {
    if (piece.startsWith("**") && piece.endsWith("**") && piece.length > 4) {
      return <strong key={`${keyPrefix}-${index}`} className="font-semibold text-ink">{piece.slice(2, -2)}</strong>;
    }
    return <span key={`${keyPrefix}-${index}`}>{piece}</span>;
  });
}

function AiResponse({ text }: { text: string }) {
  const blocks = useMemo(() => {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const nodes: ReactNode[] = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      const trimmed = line.trim();

      if (!trimmed) {
        index += 1;
        continue;
      }

      // Pipe table: header row followed by a separator row.
      if (trimmed.startsWith("|") && (lines[index + 1] ?? "").trim().match(/^\|[\s:|-]+\|?$/)) {
        const rows: string[][] = [];
        let cursor = index;
        while (cursor < lines.length && lines[cursor].trim().startsWith("|")) {
          rows.push(
            lines[cursor]
              .trim()
              .replace(/^\|/, "")
              .replace(/\|$/, "")
              .split("|")
              .map((cell) => cell.trim()),
          );
          cursor += 1;
        }
        const header = rows[0] ?? [];
        const body = rows.slice(2);
        nodes.push(
          <div key={`table-${index}`} className="my-4 overflow-x-auto rounded-xl border border-line">
            <table className="w-full border-collapse text-left text-[11px]">
              <thead className="bg-surface-2/60">
                <tr>
                  {header.map((cell, cellIndex) => (
                    <th key={cellIndex} className="whitespace-nowrap border-b border-line px-3 py-2 font-medium text-ink">
                      {inline(cell, `h-${index}-${cellIndex}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((row, rowIndex) => (
                  <tr key={rowIndex} className="border-b border-line/60 last:border-0">
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className="px-3 py-2 align-top text-ink/80">
                        {inline(cell, `c-${index}-${rowIndex}-${cellIndex}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        );
        index = cursor;
        continue;
      }

      if (/^#{1,6}\s/.test(trimmed)) {
        nodes.push(
          <h3 key={`h-${index}`} className="mt-5 font-display text-[15px] text-ink first:mt-0">
            {inline(trimmed.replace(/^#{1,6}\s+/, ""), `h-${index}`)}
          </h3>,
        );
        index += 1;
        continue;
      }

      if (/^([-*•]|\d+\.)\s+/.test(trimmed)) {
        const items: string[] = [];
        let cursor = index;
        while (cursor < lines.length && /^\s*([-*•]|\d+\.)\s+/.test(lines[cursor])) {
          items.push(lines[cursor].replace(/^\s*([-*•]|\d+\.)\s+/, ""));
          cursor += 1;
        }
        nodes.push(
          <ul key={`list-${index}`} className="my-3 list-disc space-y-1.5 pl-5 text-[12px] leading-relaxed text-ink/80">
            {items.map((item, itemIndex) => (
              <li key={itemIndex}>{inline(item, `li-${index}-${itemIndex}`)}</li>
            ))}
          </ul>,
        );
        index = cursor;
        continue;
      }

      if (/^---+$/.test(trimmed)) {
        nodes.push(<hr key={`hr-${index}`} className="my-4 border-line" />);
        index += 1;
        continue;
      }

      nodes.push(
        <p key={`p-${index}`} className="my-2.5 text-[12.5px] leading-relaxed text-ink/80">
          {inline(trimmed, `p-${index}`)}
        </p>,
      );
      index += 1;
    }

    return nodes;
  }, [text]);

  return <div className="mt-4">{blocks}</div>;
}

export function InsightsTab({ sessionId }: { sessionId: string }) {
  const toast = useToast();
  const [insight, setInsight] = useState<AIInsightsResult | null>(null);
  const [providers, setProviders] = useState<AIProviderStatus | null>(null);
  const [usage, setUsage] = useState<AIUsageSummary | null>(null);
  const [history, setHistory] = useState<AIUsageRecord[]>([]);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshMeta = useCallback(async () => {
    const [providerResult, usageResult, historyResult] = await Promise.allSettled([
      api.aiProviders(),
      api.aiUsage(),
      api.aiHistory(20),
    ]);
    if (providerResult.status === "fulfilled") setProviders(providerResult.value);
    if (usageResult.status === "fulfilled") setUsage(usageResult.value);
    if (historyResult.status === "fulfilled") setHistory(historyResult.value.records);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .cachedAiInsights(sessionId)
      .then((value) => {
        if (!cancelled) setInsight(value.insights);
      })
      .catch(() => {
        if (!cancelled) setInsight(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    void refreshMeta();
    return () => {
      cancelled = true;
    };
  }, [sessionId, refreshMeta]);

  const enabledProviders = useMemo(() => {
    if (!providers) return [];
    return Object.entries(providers.providers)
      .filter(([, info]) => info.enabled)
      .sort((a, b) => (a[1].position ?? 99) - (b[1].position ?? 99));
  }, [providers]);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const result = await api.aiInsights(sessionId, question);
      setInsight(result);
      toast.show(
        result.fallback_used
          ? `Interpretation generated by ${providerLabel(result.provider)} after a provider fallback.`
          : `Interpretation generated by ${providerLabel(result.provider)}.`,
        "success",
      );
      await refreshMeta();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : caught instanceof Error
            ? caught.message
            : "The AI providers could not be reached.",
      );
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <StepHeader
        step="Step 07 · AI Insights"
        title="What the computed results mean."
        description="The AI reads the statistics, correlations and model metrics already computed for this session. It never calculates, replaces or invents a value."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={enabledProviders.length ? "success" : "warning"}>
              <Cpu size={11} /> {enabledProviders.length} provider{enabledProviders.length === 1 ? "" : "s"}
            </Badge>
            {insight && <Badge tone="accent">{providerLabel(insight.provider)}</Badge>}
          </div>
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-[1.55fr_1fr]">
        <div className="rounded-card border border-line bg-surface p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
            <div className="flex items-center gap-2">
              <Sparkles size={15} className="text-accent" />
              <h2 className="font-display text-[15.5px] text-ink">Interpretation</h2>
            </div>
            {insight && (
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{insight.model}</Badge>
                <Badge>
                  <Coins size={10} /> {fmtInt(insight.input_tokens)} in · {fmtInt(insight.output_tokens)} out
                </Badge>
              </div>
            )}
          </div>

          {loading ? (
            <div className="mt-4 space-y-2">
              <Skeleton className="h-4 w-3/4 rounded" />
              <Skeleton className="h-4 w-full rounded" />
              <Skeleton className="h-4 w-5/6 rounded" />
              <Skeleton className="h-28 w-full rounded-xl" />
            </div>
          ) : insight ? (
            <>
              {insight.fallback_used && (
                <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-warning/30 bg-warning/5 p-3 text-[11px] leading-relaxed text-ink/80">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warning" />
                  <span>
                    A provider failed and the request fell back to {providerLabel(insight.provider)}.
                    {insight.fallback_reason ? ` Reason: ${insight.fallback_reason}` : ""}
                  </span>
                </div>
              )}
              <AiResponse text={insight.response} />
              <p className="mt-5 border-t border-line pt-3 text-[10px] text-muted">
                Generated {fmtDateTime(insight.generated_at)}
                {insight.question ? ` · answered: “${insight.question}”` : ""} · interpretation only, computed values
                are unchanged.
              </p>
            </>
          ) : (
            <div className="mt-4 rounded-xl border border-dashed border-line px-5 py-10 text-center">
              <Sparkles size={20} className="mx-auto text-muted" />
              <p className="mt-2 text-[12.5px] text-ink">No interpretation yet.</p>
              <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed text-muted">
                Generate one to have the configured provider explain the strongest patterns, data-quality caveats and
                model results. You can ask a follow-up question below.
              </p>
            </div>
          )}

          <div className="mt-5 border-t border-line pt-4">
            <label className="block">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">
                Optional question
              </span>
              <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
                <input
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  maxLength={1000}
                  placeholder="e.g. Which features matter most for the target?"
                  className="h-10 w-full rounded-xl border border-line bg-canvas px-3 text-[12.5px] text-ink outline-none focus:border-accent"
                />
                <Button
                  onClick={() => void generate()}
                  loading={generating}
                  disabled={!enabledProviders.length}
                  icon={insight ? <RefreshCw size={14} /> : <Send size={14} />}
                >
                  {generating ? "Interpreting…" : insight ? "Regenerate" : "Generate"}
                </Button>
              </div>
            </label>
            {!enabledProviders.length && providers && (
              <p className="mt-2 text-[10.5px] text-muted">
                No provider is configured. Add an API key and model to backend/.env.
              </p>
            )}
          </div>

          {error && <ErrorPanel title="AI interpretation failed" message={error} className="mt-4" />}
        </div>

        <div className="space-y-4">
          <div className="rounded-card border border-line bg-surface p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-[14.5px] text-ink">Providers</h2>
              <ShieldCheck size={14} className="text-success" />
            </div>
            <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
              Tried in this order. Keys stay on the server.
            </p>
            <div className="mt-3 space-y-2">
              {providers ? (
                Object.entries(providers.providers)
                  .sort((a, b) => (a[1].position ?? 99) - (b[1].position ?? 99))
                  .map(([name, info]) => (
                    <div
                      key={name}
                      className="flex items-center justify-between gap-2 rounded-lg border border-line bg-canvas px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[12px] text-ink">{providerLabel(name)}</p>
                        <p className="truncate font-mono text-[9.5px] text-muted">
                          {info.model || "no model configured"}
                        </p>
                      </div>
                      <Badge tone={info.enabled ? "success" : info.configured ? "warning" : "neutral"}>
                        {info.enabled ? "ready" : info.configured ? "incomplete" : "not set"}
                      </Badge>
                    </div>
                  ))
              ) : (
                <Skeleton className="h-24 w-full rounded-lg" />
              )}
            </div>
          </div>

          <div className="rounded-card border border-line bg-surface p-5">
            <h2 className="font-display text-[14.5px] text-ink">Token usage</h2>
            {usage ? (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {[
                    { label: "Requests", value: fmtInt(usage.total_requests) },
                    { label: "Successful", value: fmtInt(usage.successful_requests) },
                    { label: "Input tokens", value: fmtInt(usage.total_input_tokens) },
                    { label: "Output tokens", value: fmtInt(usage.total_output_tokens) },
                  ].map((item) => (
                    <div key={item.label} className="rounded-lg border border-line bg-canvas px-3 py-2">
                      <p className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-muted">{item.label}</p>
                      <p className="mt-0.5 font-display text-[15px] text-ink">{item.value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 space-y-1.5">
                  {Object.entries(usage.providers).map(([name, stats]) => (
                    <div key={name} className="flex items-center justify-between text-[10.5px]">
                      <span className="text-muted">{providerLabel(name)}</span>
                      <span className="font-mono text-ink/80">
                        {stats.successes}/{stats.requests} ok · {fmtInt(stats.input_tokens + stats.output_tokens)} tok
                      </span>
                    </div>
                  ))}
                  {!Object.keys(usage.providers).length && (
                    <p className="text-[10.5px] text-muted">No AI request has been made yet.</p>
                  )}
                </div>
              </>
            ) : (
              <Skeleton className="mt-3 h-28 w-full rounded-lg" />
            )}
          </div>
        </div>
      </div>

      <div className="rounded-card border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-[15px] text-ink">Provider history</h2>
            <p className="text-[10.5px] text-muted">Every attempt, including failures and fallbacks.</p>
          </div>
          <Badge>{history.length}</Badge>
        </div>
        {history.length ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="bg-surface-2/50">
                  {["When", "Provider", "Model", "Status", "Tokens", "Fallback", "Detail"].map((header) => (
                    <th
                      key={header}
                      className="whitespace-nowrap border-b border-line px-4 py-2.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 10).map((record, index) => (
                  <tr key={`${record.timestamp}-${index}`} className="border-b border-line/60 last:border-0">
                    <td className="whitespace-nowrap px-4 py-2.5 text-[11px] text-muted">
                      {fmtDateTime(record.timestamp)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-[11px] text-ink">
                      {providerLabel(record.provider)}
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-2.5 font-mono text-[10px] text-muted">
                      {record.model}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5">
                      <Badge tone={record.status === "success" ? "success" : "danger"}>{record.status}</Badge>
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 font-mono text-[10px] text-ink/80">
                      {fmtInt(record.input_tokens)} / {fmtInt(record.output_tokens)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-[10.5px] text-muted">
                      {record.fallback_used ? "yes" : "—"}
                    </td>
                    <td className="max-w-[320px] truncate px-4 py-2.5 text-[10.5px] text-muted" title={record.error ?? ""}>
                      {record.error ?? (record.fallback_reason || "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="px-5 py-8 text-center text-[11.5px] text-muted">No provider attempts recorded yet.</p>
        )}
      </div>
    </div>
  );
}
