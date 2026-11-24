import { FileDown, FileSpreadsheet, FileText, Sparkles, Table2, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Badge, Button, ErrorPanel, StepHeader } from "../../components/ui";
import { ApiError, REPORT_FILENAMES, api, apiUrl } from "../../lib/api";
import { fmtDateTime, fmtInt } from "../../lib/format";
import { useToast } from "../../lib/toast";
import type { Session } from "../../lib/types";

const artefacts = [
  {
    key: "pdf",
    label: "PDF report",
    icon: FileText,
    detail: "Sources, wrangling log, fusion stats, insights, charts, model comparison and limitations.",
  },
  {
    key: "csv",
    label: "Fused dataset",
    icon: Table2,
    detail: "The exact table used by EDA and modelling, with conflict alternates.",
  },
  {
    key: "xlsx",
    label: "Excel summary",
    icon: FileSpreadsheet,
    detail: "Seven sheets plus a 500-row fused preview.",
  },
] as const;

export function ReportsTab({
  session,
  onRefresh,
}: {
  session: Session;
  onRefresh: () => Promise<void> | void;
}) {
  const toast = useToast();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      await api.createReport(session.id);
      await onRefresh();
      toast.show("PDF, fused CSV and Excel summary generated.", "success");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Report generation failed.");
    } finally {
      setGenerating(false);
    }
  };

  const reports = [...session.reports].sort((a, b) => b.created_at.localeCompare(a.created_at));

  return (
    <div className="space-y-6">
      <StepHeader
        step="Step 09 · Report"
        title="Package this fusion."
        description="Assembled from this session's stored statistics, model results and charts. Regenerate after retraining."
        actions={
          <Button onClick={() => void generate()} loading={generating} icon={<FileDown size={14} />}>
            {generating ? "Building charts & PDF…" : "Generate report"}
          </Button>
        }
      />

      {!session.has_model && (
        <div className="flex items-start gap-2.5 rounded-card border border-warning/30 bg-warning/5 p-4 text-[11.5px] leading-relaxed text-ink/80">
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-warning" />
          <span>
            No model trained yet — the report will note that the ML section was skipped.
          </span>
        </div>
      )}

      {error && <ErrorPanel title="Report generation failed" message={error} />}

      <div className="grid gap-3 md:grid-cols-3">
        {artefacts.map((artefact) => {
          const Icon = artefact.icon;
          return (
            <div key={artefact.key} className="rounded-card border border-line bg-surface p-4">
              <div className="flex items-center gap-2 text-accent">
                <Icon size={15} />
                <p className="text-[12px] font-medium text-ink">{artefact.label}</p>
              </div>
              <p className="mt-2 text-[10.5px] leading-relaxed text-muted">{artefact.detail}</p>
            </div>
          );
        })}
      </div>

      {generating && (
        <div className="flex items-center gap-3 rounded-card border border-line bg-surface p-5">
          <Sparkles size={17} className="animate-pulse text-accent" />
          <div>
            <p className="text-[12.5px] font-medium text-ink">Rendering report artefacts</p>
            <p className="text-[11px] text-muted">Drawing charts, then writing the PDF and workbook.</p>
          </div>
        </div>
      )}

      <div className="rounded-card border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="font-display text-[15.5px] text-ink">Generated for this session</h2>
          <Badge>{reports.length}</Badge>
        </div>
        {reports.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <p className="text-[12.5px] text-ink">No report generated yet.</p>
            <p className="mt-1 text-[11px] text-muted">Generated reports are also listed in Fusion Reports.</p>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {reports.map((report, index) => (
              <div key={report.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[12.5px] font-medium text-ink">
                      {index === 0 ? "Latest report" : `Report ${report.id.slice(0, 6)}`}
                    </p>
                    <Badge>{report.best_model ?? "no model"}</Badge>
                  </div>
                  <p className="mt-1 text-[10.5px] text-muted">
                    {fmtDateTime(report.created_at)} · {fmtInt(report.rows)} rows · {fmtInt(report.features)} columns ·
                    target {report.target ?? "none"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {artefacts.map((artefact) => {
                    const Icon = artefact.icon;
                    return (
                      <a
                        key={artefact.key}
                        href={apiUrl(report.downloads[artefact.key])}
                        onClick={(event) => {
                          event.preventDefault();
                          void api
                            .download(
                              report.downloads[artefact.key],
                              REPORT_FILENAMES[artefact.key],
                            )
                            .catch(() => undefined);
                        }}
                        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line px-3 text-[10.5px] text-ink transition hover:border-accent/60 hover:text-accent"
                      >
                        <Icon size={12} /> {artefact.label}
                      </a>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
