import {
  ArrowDownToLine,
  CalendarClock,
  Copy,
  Eraser,
  Hash,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, Button, ErrorPanel, Skeleton, StatCard, StepHeader } from "../../components/ui";
import { api, apiUrl } from "../../lib/api";
import { fmtInt, fmtPct } from "../../lib/format";
import type { CleanReport, CleanResponse } from "../../lib/types";

function MiniSnapshot({ report }: { report: CleanReport }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {[
        { label: "Rows", before: report.before.rows, after: report.after.rows },
        { label: "Columns", before: report.before.columns, after: report.after.columns },
        { label: "Missing cells", before: report.before.missing_cells, after: report.after.missing_cells },
      ].map((item) => (
        <div key={item.label} className="rounded-xl border border-line bg-canvas px-3 py-2.5">
          <p className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-muted">{item.label}</p>
          <p className="mt-1 text-[12px] text-ink">
            {fmtInt(item.before)} <span className="text-muted">→</span>{" "}
            <span className={item.after < item.before ? "text-success" : ""}>{fmtInt(item.after)}</span>
          </p>
        </div>
      ))}
    </div>
  );
}

export function CleanDataTab({ sessionId }: { sessionId: string }) {
  const [data, setData] = useState<CleanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api
      .clean(sessionId)
      .then(setData)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load cleaning results."));
  };

  useEffect(load, [sessionId]);

  if (error) return <ErrorPanel message={error} onRetry={load} />;

  if (!data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((item) => (
            <Skeleton key={item} className="h-24 rounded-card" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-card" />
      </div>
    );
  }

  const { totals } = data;

  return (
    <div className="space-y-6">
      <StepHeader
        step="Step 02 · Clean"
        title="What wrangling changed."
        description="Counts recorded by the cleaning engine for every source. Each cleaned CSV can be downloaded."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Rows kept"
          value={`${fmtInt(totals.rows_after)}`}
          hint={`${fmtInt(totals.rows_before)} before · ${fmtInt(totals.rows_before - totals.rows_after)} removed`}
          icon={<Eraser size={15} />}
        />
        <StatCard
          label="Duplicates removed"
          value={fmtInt(totals.duplicates_removed)}
          hint="Exact duplicate rows across all sources"
          icon={<Copy size={15} />}
        />
        <StatCard
          label="Missing cells filled"
          value={fmtInt(totals.missing_filled)}
          hint="Median / mode / fill methods, logged per column"
          icon={<SlidersHorizontal size={15} />}
        />
        <StatCard
          label="Formats normalised"
          value={fmtInt(totals.numeric_fixed + totals.dates_fixed)}
          hint={`${totals.numeric_fixed} numeric · ${totals.dates_fixed} date columns`}
          icon={<CalendarClock size={15} />}
        />
      </div>

      {data.reports.map((report) => {
        const download = data.downloads[report.source];
        return (
          <div key={report.source} className="rounded-card border border-line bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="font-display text-[16px] text-ink">{report.source}</h2>
                  <Badge>{report.before.rows} → {report.after.rows} rows</Badge>
                </div>
                <p className="mt-1 text-[10.5px] text-muted">
                  {fmtInt(report.before.missing_cells)} missing cells before ·{" "}
                  {fmtPct(report.before.missing_pct)} · {report.before.duplicate_rows} duplicate rows detected
                </p>
              </div>
              {download && (
                <a
                  href={apiUrl(download)}
                  onClick={(event) => {
                    event.preventDefault();
                    void api
                      .download(download, `${report.source}_cleaned.csv`)
                      .catch(() => undefined);
                  }}
                >
                  <Button size="sm" variant="secondary" icon={<ArrowDownToLine size={13} />}>
                    Cleaned CSV
                  </Button>
                </a>
              )}
            </div>

            <div className="space-y-5 p-5">
              <MiniSnapshot report={report} />

              {report.notes.length > 0 && (
                <div className="flex items-start gap-2 rounded-xl border border-line bg-canvas p-3">
                  <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warning" />
                  <div className="space-y-1 text-[11px] leading-relaxed text-muted">
                    {report.notes.map((note) => (
                      <p key={note}>{note}</p>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid gap-5 xl:grid-cols-2">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted">
                    Missing values handled
                  </p>
                  {report.missing.length ? (
                    <div className="mt-2 overflow-x-auto rounded-xl border border-line">
                      <table className="w-full text-left text-[11.5px]">
                        <thead className="bg-surface-2/60 text-[9px] uppercase tracking-[0.1em] text-muted">
                          <tr>
                            <th className="px-3 py-2 font-medium">Column</th>
                            <th className="px-3 py-2 font-medium">Filled</th>
                            <th className="px-3 py-2 font-medium">Method</th>
                            <th className="px-3 py-2 font-medium">Left</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {report.missing.map((entry) => (
                            <tr key={entry.column}>
                              <td className="px-3 py-2 font-mono text-[10.5px] text-ink/85">{entry.column}</td>
                              <td className="px-3 py-2 text-ink">{entry.before}</td>
                              <td className="max-w-[220px] px-3 py-2 text-muted">{entry.method}</td>
                              <td className="px-3 py-2">{entry.after}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-2 text-[11.5px] text-muted">No missing cells were found in this source.</p>
                  )}
                </div>

                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-muted">
                    Format & outlier fixes
                  </p>
                  <div className="mt-2 space-y-2">
                    {report.numeric_converted.map((entry) => (
                      <div key={`num-${entry.column}`} className="flex items-start gap-2 rounded-xl border border-line bg-canvas px-3 py-2">
                        <Hash size={12} className="mt-0.5 text-accent" />
                        <div className="text-[11px] leading-relaxed">
                          <span className="font-mono text-[10.5px] text-ink">{entry.column}</span>
                          <span className="text-muted"> · {fmtInt(entry.values)} values parsed to numeric</span>
                          {entry.examples.length > 0 && (
                            <span className="block text-[10px] text-muted/80">
                              e.g. {entry.examples.map((example) => `"${example}"`).join(", ")}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                    {report.dates_parsed.map((entry) => (
                      <div key={`date-${entry.column}`} className="flex items-start gap-2 rounded-xl border border-line bg-canvas px-3 py-2">
                        <CalendarClock size={12} className="mt-0.5 text-accent" />
                        <div className="text-[11px] leading-relaxed">
                          <span className="font-mono text-[10.5px] text-ink">{entry.column}</span>
                          <span className="text-muted"> · {fmtInt(entry.parsed)} dates parsed</span>
                          {entry.failed > 0 && <span className="text-warning"> · {entry.failed} could not parse</span>}
                        </div>
                      </div>
                    ))}
                    {report.casing_fixed.map((entry) => (
                      <div key={`case-${entry.column}`} className="flex items-start gap-2 rounded-xl border border-line bg-canvas px-3 py-2">
                        <Sparkles size={12} className="mt-0.5 text-accent" />
                        <div className="text-[11px] leading-relaxed">
                          <span className="font-mono text-[10.5px] text-ink">{entry.column}</span>
                          <span className="text-muted"> · {fmtInt(entry.values)} categories standardised</span>
                          <span className="block text-[10px] text-muted/80">
                            from {entry.before.map((value) => `"${value}"`).join(", ")}
                          </span>
                        </div>
                      </div>
                    ))}
                    {report.outliers.map((entry) => (
                      <div key={`out-${entry.column}`} className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/5 px-3 py-2">
                        <TriangleAlert size={12} className="mt-0.5 text-warning" />
                        <div className="text-[11px] leading-relaxed">
                          <span className="font-mono text-[10.5px] text-ink">{entry.column}</span>
                          <span className="text-muted">
                            {" "}
                            · {fmtInt(entry.count)} outliers capped to [{entry.lower}, {entry.upper}]
                          </span>
                        </div>
                      </div>
                    ))}
                    {!report.numeric_converted.length &&
                      !report.dates_parsed.length &&
                      !report.casing_fixed.length &&
                      !report.outliers.length && (
                        <p className="text-[11.5px] text-muted">No format or outlier issues were detected.</p>
                      )}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-3 text-[10.5px] text-muted">
                <span>{report.whitespace_fixed} whitespace fixes</span>
                <span>{report.duplicates_removed} exact duplicates removed</span>
                <span>{report.dropped_all_null.length} all-null columns dropped</span>
                <span>{report.constant_columns.length} constant columns recorded</span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
