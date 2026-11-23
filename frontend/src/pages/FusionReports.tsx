import { motion } from "framer-motion";
import { ArrowUpRight, Download, FileSpreadsheet, FileText, RefreshCw, Table2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, EmptyState, ErrorPanel, PageHeader, Skeleton } from "../components/ui";
import { api, apiUrl } from "../lib/api";
import { fmtDateTime, fmtInt, fmtNumber } from "../lib/format";
import type { Report } from "../lib/types";

const downloads = [
  { kind: "pdf", label: "PDF report", icon: FileText },
  { kind: "csv", label: "Fused CSV", icon: Table2 },
  { kind: "xlsx", label: "Excel summary", icon: FileSpreadsheet },
] as const;

export function FusionReportsPage() {
  const navigate = useNavigate();
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api
      .reports()
      .then(setReports)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load reports."));
  };

  useEffect(load, []);

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-20 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Artefacts"
        title="Fusion Reports"
        description="Generated from stored sessions: PDF narrative, fused CSV and Excel workbook."
        actions={
          <Button variant="secondary" size="sm" onClick={load} icon={<RefreshCw size={13} />}>
            Refresh
          </Button>
        }
      />

      {error && <ErrorPanel message={error} onRetry={load} />}

      {reports === null && !error && (
        <div className="space-y-3">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-24 w-full rounded-card" />
          ))}
        </div>
      )}

      {reports && reports.length === 0 && (
        <EmptyState
          icon={<FileText size={20} />}
          title="No reports generated yet"
          description="Finish a fusion, open the workspace and use Reports to build the PDF, CSV and Excel artefacts. They will appear here."
          action={
            <Button size="sm" onClick={() => navigate("/upload")} icon={<ArrowUpRight size={13} />}>
              Start a fusion
            </Button>
          }
        />
      )}

      {reports && reports.length > 0 && (
        <div className="space-y-3">
          {reports.map((report, index) => (
            <motion.div
              key={`${report.session_id}-${report.id}`}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04 }}
              className="rounded-card border border-line bg-surface p-5 transition hover:border-accent/40"
            >
              <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate font-display text-[16px] text-ink">
                      {report.session_name ?? "Fusion session"}
                    </h3>
                    <Badge tone="accent">{report.best_model ?? "no model"}</Badge>
                  </div>
                  <p className="mt-1.5 text-[11.5px] text-muted">
                    {fmtInt(report.rows)} rows · {fmtInt(report.features)} columns · target{" "}
                    <span className="text-ink/75">{report.target ?? "not selected"}</span> · generated{" "}
                    {fmtDateTime(report.created_at)}
                  </p>
                  {report.metrics && (
                    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-muted">
                      {Object.entries(report.metrics)
                        .filter(([, value]) => typeof value === "number")
                        .slice(0, 4)
                        .map(([key, value]) => (
                          <span key={key}>
                            {key.replace(/_/g, " ")} · {fmtNumber(value as number, 3)}
                          </span>
                        ))}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-2">
                  {downloads.map(({ kind, label, icon: Icon }) => (
                    <a
                      key={kind}
                      href={apiUrl(report.downloads[kind])}
                      className="inline-flex h-9 items-center gap-2 rounded-pill border border-line bg-canvas px-3.5 text-[11.5px] text-ink transition hover:border-accent/60 hover:text-accent"
                    >
                      <Icon size={13} />
                      {label}
                      <Download size={11} className="opacity-60" />
                    </a>
                  ))}
                  {report.session_id && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => navigate(`/workspace/${report.session_id}/reports`)}
                    >
                      Open session
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
