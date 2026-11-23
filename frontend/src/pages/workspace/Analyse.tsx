import { motion } from "framer-motion";
import {
  AlertTriangle,
  BarChart3,
  Database,
  Info,
  Search,
  Sparkles,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, ErrorPanel, InfoTip, Skeleton, StatCard, StepHeader } from "../../components/ui";
import { api } from "../../lib/api";
import { fmtInt, fmtNumber, fmtPct } from "../../lib/format";
import type { AnalyseResponse, Insight } from "../../lib/types";
import { displayCell } from "../../lib/format";

function insightIcon(kind: string) {
  if (kind === "warning") return <TriangleAlert size={14} className="text-warning" />;
  if (kind === "pattern") return <TrendingUp size={14} className="text-accent" />;
  return <Info size={14} className="text-muted" />;
}

function SummaryBars({ rows }: { rows: AnalyseResponse["summary"] }) {
  return (
    <div className="space-y-4">
      {rows.map((row) => {
        const span = row.max - row.min || 1;
        const q1 = ((row.q1 - row.min) / span) * 100;
        const median = ((row.median - row.min) / span) * 100;
        const q3 = ((row.q3 - row.min) / span) * 100;
        return (
          <div key={row.column}>
            <div className="flex items-baseline justify-between gap-3">
              <p
              className="max-w-[62%] break-words font-mono text-[10px] leading-tight text-ink/85"
              title={row.column}
            >
              {row.column}
            </p>
              <p className="shrink-0 font-mono text-[9.5px] text-muted">
                median {fmtNumber(row.median, 2)} · mean {fmtNumber(row.mean, 2)}
              </p>
            </div>
            <div
              className="relative mt-2 h-5 rounded-md"
              title={`min ${row.min} · Q1 ${row.q1} · median ${row.median} · Q3 ${row.q3} · max ${row.max}`}
            >
              <div className="absolute inset-x-0 top-1/2 h-[1px] -translate-y-1/2 bg-line" />
              <div
                className="absolute top-1/2 h-2.5 w-[1px] -translate-y-1/2 bg-muted"
                style={{ left: "0%" }}
              />
              <div
                className="absolute top-1/2 h-2.5 w-[1px] -translate-y-1/2 bg-muted"
                style={{ left: "100%" }}
              />
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(1, q3 - q1)}%` }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className="absolute top-1/2 h-3.5 -translate-y-1/2 rounded-sm border border-accent/50 bg-accent-soft"
                style={{ left: `${q1}%` }}
              />
              <div
                className="absolute top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-full bg-accent"
                style={{ left: `${median}%` }}
              />
            </div>
            <div className="mt-0.5 flex justify-between font-mono text-[9px] text-muted">
              <span>{fmtNumber(row.min, 2)}</span>
              <span>{fmtNumber(row.max, 2)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AnalyseTab({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<AnalyseResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");

  const load = () => {
    setError(null);
    api
      .analyse(sessionId)
      .then(setData)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not analyse this dataset."));
  };

  useEffect(load, [sessionId]);

  const overview = useMemo(() => {
    if (!data) return [];
    const needle = search.trim().toLowerCase();
    return data.overview.filter((row) => {
      const matchesType = typeFilter === "All" || row.type === typeFilter;
      const matchesSearch = !needle || row.feature.toLowerCase().includes(needle);
      return matchesType && matchesSearch;
    });
  }, [data, search, typeFilter]);

  if (error) return <ErrorPanel message={error} onRetry={load} />;

  if (!data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-56" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-24 rounded-card" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-card" />
      </div>
    );
  }

  const types = ["All", ...Array.from(new Set(data.overview.map((row) => row.type)))];

  return (
    <div className="space-y-6">
      <StepHeader
        step="Step 04 · Explore"
        title="The shape of the fused data."
        description="Statistics on the reconciled dataset, plus rule-based insights."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Total records"
          value={fmtInt(data.stats.total_records)}
          hint={`${data.stats.numeric_columns} numeric · ${data.stats.categorical_columns} categorical`}
          icon={<Database size={15} />}
          tone="accent"
        />
        <StatCard
          label="Features"
          value={fmtInt(data.stats.features)}
          hint="All columns in the fused table"
          icon={<BarChart3 size={15} />}
        />
        <StatCard
          label="Missing values"
          value={fmtPct(data.stats.missing_pct)}
          hint="Remaining after source-level filling and fusion"
          icon={<AlertTriangle size={15} />}
        />
        <StatCard
          label="Duplicates"
          value={fmtInt(data.stats.duplicates)}
          hint="Fully identical fused rows"
          icon={<Sparkles size={15} />}
        />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[1.35fr_1fr]">
        <div className="rounded-card border border-line bg-surface">
          <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-display text-[15.5px] text-ink">Dataset overview</h2>
              <p className="text-[10.5px] text-muted">{overview.length} of {data.overview.length} columns shown</p>
            </div>
            <label className="relative">
              <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find a column…"
                aria-label="Filter columns"
                className="h-9 w-full min-w-[190px] rounded-full border border-line bg-canvas pl-9 pr-3 text-[12px] text-ink outline-none focus:border-accent"
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-1.5 border-b border-line px-4 py-2.5">
            {types.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setTypeFilter(type)}
                className={`rounded-full px-2.5 py-1 text-[10.5px] transition ${
                  typeFilter === type
                    ? "bg-accent text-[#fff8f2]"
                    : "border border-line text-muted hover:border-accent/50 hover:text-ink"
                }`}
              >
                {type}
              </button>
            ))}
          </div>
          <div className="max-h-[480px] overflow-auto">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-surface-2">
                <tr>
                  {["Feature", "Type", "Missing", "Unique", "Range / top value"].map((header) => (
                    <th
                      key={header}
                      className="whitespace-nowrap border-b border-line px-3 py-2 font-mono text-[9px] uppercase tracking-[0.1em] text-muted"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {overview.map((row) => (
                  <tr key={row.feature} className="border-b border-line/60 last:border-0 hover:bg-surface-2/30">
                    <td className="max-w-[200px] truncate px-3 py-2 font-mono text-[10.5px] text-ink/85">
                      {row.feature}
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={row.type === "Numeric" ? "accent" : "neutral"}>{row.type}</Badge>
                    </td>
                    <td
                      className={`px-3 py-2 text-[11px] ${
                        row.missing_pct > 20 ? "text-danger" : row.missing_pct > 0 ? "text-warning" : "text-muted"
                      }`}
                    >
                      {fmtPct(row.missing_pct)}
                    </td>
                    <td className="px-3 py-2 text-[11px] text-muted">{fmtInt(row.unique)}</td>
                    <td className="max-w-[220px] truncate px-3 py-2 text-[11px] text-muted">
                      {row.type === "Numeric"
                        ? `${fmtNumber(row.min ?? null, 2)} → ${fmtNumber(row.max ?? null, 2)}`
                        : row.type === "Date"
                          ? `${displayCell(row.min)} → ${displayCell(row.max)}`
                          : `${row.top ?? "—"} (${fmtInt(row.top_count ?? 0)})`}
                    </td>
                  </tr>
                ))}
                {!overview.length && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-[12px] text-muted">
                      No columns match this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-card border border-line bg-surface p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-[15.5px] text-ink">Statistical summary</h2>
              <Badge tone="accent">IQR</Badge>
            </div>
            <p className="mt-1 text-[10.5px] text-muted">
              Whisker line = min → max. Box = Q1 → Q3, accent line = median.
            </p>
            <div className="mt-5">
              {data.summary.length ? (
                <SummaryBars rows={data.summary} />
              ) : (
                <p className="text-[12px] text-muted">No numeric columns are available for a summary.</p>
              )}
            </div>
          </div>

          <div className="rounded-card border border-line bg-surface p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-[15.5px] text-ink">Target</h2>
              <Badge>{data.target?.task ?? "not set"}</Badge>
            </div>
            {data.target ? (
              <>
                <p className="mt-2 font-mono text-[13px] text-ink">{data.target.column}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted">
                  {data.target.reason ?? "Suggested from column types and class balance."}
                </p>
              </>
            ) : (
              <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
                None selected yet. Choose one in Train Models.
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-card border border-line bg-surface p-5">
                    <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-accent" />
          <h2 className="font-display text-[15.5px] text-ink">Key insights</h2>
          <InfoTip label="How insights are generated" align="end" className="ml-auto">
            Each insight is derived by a fixed rule from this dataset's own statistics — no templates and no
            placeholder numbers.
          </InfoTip>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {data.insights.map((insight: Insight) => (
            <div
              key={`${insight.title}-${insight.text}`}
              className={`flex items-start gap-3 rounded-xl border p-3.5 ${
                insight.kind === "warning"
                  ? "border-warning/25 bg-warning/5"
                  : insight.kind === "pattern"
                    ? "border-accent/25 bg-accent-soft/30"
                    : "border-line bg-canvas"
              }`}
            >
              <span className="mt-0.5">{insightIcon(insight.kind)}</span>
              <div>
                <p className="text-[12px] font-medium text-ink">{insight.title}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{insight.text}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
