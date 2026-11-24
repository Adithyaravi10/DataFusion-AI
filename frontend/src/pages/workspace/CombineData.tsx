import {
  ArrowDownToLine,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  GitMerge,
  Link2,
  Search,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, ErrorPanel, Skeleton, StatCard, StepHeader } from "../../components/ui";
import { api, apiUrl } from "../../lib/api";
import { displayCell, fmtInt, fmtPct } from "../../lib/format";
import type { CombineResponse } from "../../lib/types";

export function CombineDataTab({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<CombineResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<string | null>(null);
  const [direction, setDirection] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput);
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .combine(sessionId, { page, pageSize, search, sort: sort ?? undefined, direction })
      .then((value) => {
        if (!cancelled) {
          setData(value);
          setError(null);
        }
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load fusion results.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, page, pageSize, search, sort, direction]);

  const changeSort = (column: string) => {
    if (sort === column) {
      setDirection((value) => (value === "asc" ? "desc" : "asc"));
    } else {
      setSort(column);
      setDirection("asc");
    }
    setPage(1);
  };

  if (error) return <ErrorPanel message={error} onRetry={() => window.location.reload()} />;

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

  const { stats, table } = data;
  const matchRate =
    stats.steps.length > 0
      ? stats.steps.reduce((sum, step) => sum + step.match_rate, 0) / stats.steps.length
      : 100;

  return (
    <div className="space-y-6">
      <StepHeader
        step="Step 03 · Fusion"
        title="How the sources aligned."
        description={
          <>
            Base table <span className="font-mono text-ink/80">{stats.base_source}</span>. Exact keys first, then
            fuzzy name matches at ≥ 88.
          </>
        }
        actions={
          <a
            href={apiUrl(data.download)}
            onClick={(event) => {
              event.preventDefault();
              void api.download(data.download, "fused_dataset.csv").catch(() => undefined);
            }}
          >
            <Button size="sm" variant="secondary" icon={<ArrowDownToLine size={13} />}>
              Download fused CSV
            </Button>
          </a>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Fused records"
          value={fmtInt(stats.final_rows)}
          hint={`${fmtInt(stats.final_columns)} columns across ${stats.sources_used.length} source(s)`}
          icon={<GitMerge size={15} />}
          tone="accent"
        />
        <StatCard
          label="Average match rate"
          value={fmtPct(matchRate)}
          hint={stats.steps.length ? `${stats.steps.length} join step(s)` : "Single source — no joins"}
          icon={<Link2 size={15} />}
        />
        <StatCard
          label="Fuzzy matches"
          value={fmtInt(stats.fuzzy_total)}
          hint="Rows linked by name similarity"
          icon={<Sparkles size={15} />}
        />
        <StatCard
          label="Conflicts resolved"
          value={fmtInt(stats.conflicts_total)}
          hint="non-null → recent → majority"
          icon={<TriangleAlert size={15} />}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-card border border-line bg-surface px-4 py-3 text-[11px] text-muted">
        <span className="font-mono text-[9px] uppercase tracking-[0.14em]">Keys used</span>
        {stats.join_keys.length ? (
          stats.join_keys.map((key) => (
            <span key={key.source} className="font-mono text-[10.5px] text-ink/80">
              {key.left} = {key.right}
            </span>
          ))
        ) : (
          <span>None — a single source was cleaned and analysed without joins.</span>
        )}
      </div>

      {stats.steps.length > 0 && (
        <div className="space-y-3">
          {stats.steps.map((step, index) => (
            <div key={step.source} className="rounded-card border border-line bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-accent">0{index + 1}</span>
                    <h3 className="font-display text-[15.5px] text-ink">{step.source}</h3>
                    <Badge>{step.match_rate}% matched</Badge>
                  </div>
                  <p className="mt-1 font-mono text-[10.5px] text-muted">
                    {step.left_source}.{step.left_key} = {step.source}.{step.right_key}
                  </p>
                </div>
                <div className="flex gap-4 text-right text-[11px]">
                  <div>
                    <p className="text-muted">Exact</p>
                    <p className="font-display text-base text-ink">{fmtInt(step.exact_matches)}</p>
                  </div>
                  <div>
                    <p className="text-muted">Fuzzy</p>
                    <p className="font-display text-base text-accent">{fmtInt(step.fuzzy_matches)}</p>
                  </div>
                  <div>
                    <p className="text-muted">Unmatched</p>
                    <p className="font-display text-base text-ink">{fmtInt(step.unmatched)}</p>
                  </div>
                </div>
              </div>

              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-accent" style={{ width: `${step.match_rate}%` }} />
              </div>

              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[10.5px] text-muted">
                <span>{fmtInt(step.rows_before)} rows before → {fmtInt(step.rows_after)} after</span>
                <span>{step.columns_added} columns added</span>
                {step.aggregated_from !== null && (
                  <span>
                    aggregated {fmtInt(step.aggregated_from)} → {fmtInt(step.aggregated_to ?? 0)} rows per key
                  </span>
                )}
                <span>
                  {step.conflicts.length} conflicting column{step.conflicts.length === 1 ? "" : "s"}
                </span>
              </div>

              {step.fuzzy_examples.length > 0 && (
                <p className="mt-2 rounded-lg bg-canvas px-3 py-2 font-mono text-[10px] leading-relaxed text-muted">
                  Fuzzy links: {step.fuzzy_examples.join(" · ")}
                </p>
              )}

              {step.conflicts.length > 0 && (
                <div className="mt-3 overflow-x-auto rounded-xl border border-line">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-surface-2/60 text-[9px] uppercase tracking-[0.1em] text-muted">
                      <tr>
                        <th className="px-3 py-2 font-medium">Column</th>
                        <th className="px-3 py-2 font-medium">Rows</th>
                        <th className="px-3 py-2 font-medium">Rule</th>
                        <th className="px-3 py-2 font-medium">Example</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {step.conflicts.map((conflict) => (
                        <tr key={conflict.column}>
                          <td className="px-3 py-2 font-mono text-[10.5px] text-ink/85">{conflict.column}</td>
                          <td className="px-3 py-2">{conflict.rows}</td>
                          <td className="px-3 py-2 text-muted">{conflict.rule}</td>
                          <td className="px-3 py-2 text-[10.5px] text-muted">
                            {conflict.examples[0]
                              ? `${displayCell(conflict.examples[0].left)} vs ${displayCell(conflict.examples[0].right)} → ${displayCell(conflict.examples[0].kept)}`
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="rounded-card border border-line bg-surface">
        <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-display text-[15.5px] text-ink">Fused dataset preview</h2>
            <p className="text-[10.5px] text-muted">
              {fmtInt(table.total)} matching rows · page {table.page} of {table.pages}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <Search size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Search all columns…"
                className="h-9 w-full min-w-[210px] rounded-full border border-line bg-canvas pl-9 pr-3 text-[12px] text-ink outline-none transition focus:border-accent"
                aria-label="Search fused dataset"
              />
            </label>
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
              aria-label="Rows per page"
              className="h-9 rounded-full border border-line bg-canvas px-3 text-[11.5px] text-ink"
            >
              {[10, 20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size} / page
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className={`overflow-x-auto transition-opacity ${loading ? "opacity-60" : ""}`}>
          <table className="min-w-full border-collapse text-left">
            <thead>
              <tr className="bg-surface-2/50">
                {table.columns.map((column) => (
                  <th key={column.name} className="whitespace-nowrap border-b border-line px-3 py-2">
                    <button
                      type="button"
                      onClick={() => changeSort(column.name)}
                      className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted transition hover:text-ink"
                    >
                      {column.name}
                      <ArrowUpDown size={10} className={sort === column.name ? "text-accent" : "opacity-40"} />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-line/60 last:border-0 hover:bg-surface-2/30">
                  {table.columns.map((column) => {
                    const value = row[column.name];
                    const text = displayCell(value);
                    return (
                      <td
                        key={column.name}
                        title={text}
                        className="max-w-[240px] whitespace-nowrap px-3 py-2 text-[11.5px] text-ink/80"
                      >
                        {text}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!table.rows.length && (
                <tr>
                  <td colSpan={table.columns.length} className="px-4 py-10 text-center text-[12px] text-muted">
                    No rows match “{search}”. Clear the search to see the fused dataset.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
          <p className="text-[10.5px] text-muted">
            Showing {table.rows.length ? (table.page - 1) * table.page_size + 1 : 0}–
            {(table.page - 1) * table.page_size + table.rows.length} of {fmtInt(table.total)}
          </p>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={table.page <= 1}
              aria-label="Previous page"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-muted transition hover:border-accent hover:text-accent disabled:opacity-40"
            >
              <ChevronLeft size={13} />
            </button>
            <span className="min-w-[70px] text-center font-mono text-[10.5px] text-muted">
              {table.page} / {table.pages}
            </span>
            <button
              type="button"
              onClick={() => setPage((value) => Math.min(table.pages, value + 1))}
              disabled={table.page >= table.pages}
              aria-label="Next page"
              className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-muted transition hover:border-accent hover:text-accent disabled:opacity-40"
            >
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
