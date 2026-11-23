import {
  ArrowRight,
  ArrowUpRight,
  BrainCircuit,
  Database,
  FileDown,
  FileSpreadsheet,
  GitMerge,
  Sparkles,
  Target,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, EmptyState, LinkArrow, SectionLabel, StatCard } from "../../components/ui";
import { fmtBytes, fmtDateTime, fmtInt, fmtPct, fmtNumber } from "../../lib/format";
import type { Session } from "../../lib/types";

type TabKey =
  | "dashboard"
  | "clean"
  | "combine"
  | "analyse"
  | "charts"
  | "train"
  | "ai"
  | "predict"
  | "reports";

const pipeline = [
  { step: "02", label: "Clean Data", tab: "clean" as TabKey, note: "Before/after stats per source" },
  { step: "03", label: "Combine Data", tab: "combine" as TabKey, note: "Joins, matches and conflicts" },
  { step: "04", label: "Analyse Data", tab: "analyse" as TabKey, note: "Profile, summary and insights" },
  { step: "05", label: "View Charts", tab: "charts" as TabKey, note: "Five required visuals and more" },
  { step: "06", label: "Train Models", tab: "train" as TabKey, note: "Four models, test split and CV" },
  { step: "07", label: "AI Insights", tab: "ai" as TabKey, note: "Explain the computed results" },
  { step: "08", label: "Predict", tab: "predict" as TabKey, note: "Single record and batch scoring" },
  { step: "09", label: "Reports", tab: "reports" as TabKey, note: "PDF, CSV and Excel artefacts" },
];

export function OverviewTab({
  session,
  onNavigate,
}: {
  session: Session;
  onNavigate: (key: TabKey) => void;
}) {
  const navigate = useNavigate();
  const fusion = session.fusion;

  if (!fusion) {
    return (
      <EmptyState
        icon={<GitMerge size={20} />}
        title="No fused dataset yet"
        description="This session has uploads but no completed fusion. Run the pipeline to generate the results workspace."
        action={
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() =>
                session.job_id ? navigate(`/fusion/${session.job_id}`) : navigate("/upload")
              }
            >
              {session.job_id ? "Continue fusion" : "Upload datasets"}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => navigate("/history")}>
              Open history
            </Button>
          </div>
        }
      />
    );
  }

  const target = session.target;
  const model = session.model;
  const missingPct = fusion.final_rows
    ? ((fusion.remaining_missing ?? 0) / (fusion.final_rows * fusion.final_columns)) * 100
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-card border border-line bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <SectionLabel>Fused session</SectionLabel>
            <h1 className="mt-2 max-w-xl font-display text-[clamp(1.5rem,3vw,2rem)] leading-tight text-ink">
              {session.name}
            </h1>
            <p className="mt-2 text-[12px] text-muted">
              Completed {fusion.completed_at ? fmtDateTime(fusion.completed_at) : "—"} · base table{" "}
              <span className="font-mono text-ink/80">{fusion.base_source}</span> ·{" "}
              {fusion.sources_used.length} source{fusion.sources_used.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => onNavigate("combine")} icon={<GitMerge size={13} />}>
              Inspect fusion
            </Button>
            <Button size="sm" onClick={() => onNavigate(model ? "predict" : "train")} icon={<ArrowRight size={13} />}>
              {model ? "Make a prediction" : "Train models"}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Fused records"
          value={fmtInt(fusion.final_rows)}
          hint={`From ${fmtInt(fusion.source_files?.length ?? session.files.length)} source files`}
          icon={<Database size={16} />}
          tone="accent"
        />
        <StatCard
          label="Features"
          value={fmtInt(fusion.final_columns)}
          hint={`${missingPct < 0.01 ? "0" : fmtNumber(missingPct, 1)}% of merged cells empty`}
          icon={<Sparkles size={16} />}
        />
        <StatCard
          label="Conflicts resolved"
          value={fmtInt(fusion.conflicts_total)}
          hint={`${fmtInt(fusion.fuzzy_total)} fuzzy matches · ${fmtInt(fusion.duplicates_removed)} duplicates removed`}
          icon={<GitMerge size={16} />}
        />
        <StatCard
          label="Reports"
          value={fmtInt(session.reports.length)}
          hint={session.reports.length ? "Artefacts stored on disk" : "Generate in Reports"}
          icon={<FileDown size={16} />}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
        <div className="rounded-card border border-line bg-surface p-5">
          <div className="flex items-center justify-between">
            <SectionLabel>Sources in this fusion</SectionLabel>
            <Badge>{session.files.length} files</Badge>
          </div>
          <div className="mt-4 divide-y divide-line">
            {session.files.map((file) => (
              <div key={file.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-canvas text-accent">
                  <FileSpreadsheet size={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium text-ink">{file.name}</p>
                  <p className="text-[10.5px] text-muted">
                    {file.format} · {fmtBytes(file.size)} · {file.rows} rows × {file.cols} cols after cleaning
                  </p>
                </div>
                <Badge tone="neutral">{file.source}</Badge>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-card border border-line bg-surface p-5">
          <div className="flex items-center justify-between">
            <SectionLabel>Target & model</SectionLabel>
            <Target size={14} className="text-accent" />
          </div>
          {target ? (
            <div className="mt-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">Suggested target</p>
              <p className="mt-1.5 font-display text-2xl text-ink">{target.column}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone="accent">{target.task}</Badge>
                {target.missing_pct !== undefined && <Badge>{fmtPct(target.missing_pct)} missing</Badge>}
              </div>
              <p className="mt-3 text-[11.5px] leading-relaxed text-muted">
                {target.reason ?? "Inferred from the fused column types."} Override it on Train Models.
              </p>
            </div>
          ) : (
            <p className="mt-4 text-[12px] leading-relaxed text-muted">
              No target detected. Choose one in Train Models.
            </p>
          )}
          <div className="mt-5 rounded-xl border border-line bg-canvas p-3.5">
            <div className="flex items-center gap-2">
              <BrainCircuit size={15} className="text-accent" />
              <p className="text-[11.5px] font-medium text-ink">
                {model ? `${model.best_model} saved` : "No model trained yet"}
              </p>
            </div>
            <p className="mt-1 text-[10.5px] leading-relaxed text-muted">
              {model
                ? `Target ${model.target} · ${model.task} · trained ${fmtDateTime(model.trained_at)}`
                : "Four estimators compared on one split and k-fold CV."}
            </p>
            <button
              type="button"
              onClick={() => onNavigate("train")}
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-accent"
            >
              {model ? "Review model results" : "Train models"} <ArrowUpRight size={12} />
            </button>
          </div>
        </div>
      </div>

      <div className="rounded-card border border-line bg-surface p-5">
        <SectionLabel>Continue the workflow</SectionLabel>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {pipeline.map((step) => (
            <button
              key={step.tab}
              type="button"
              onClick={() => onNavigate(step.tab)}
              className="group flex items-center gap-3 rounded-xl border border-line bg-canvas px-3.5 py-3 text-left transition hover:border-accent/50 hover:bg-accent-soft/20"
            >
              <span className="font-mono text-[9.5px] text-accent">{step.step}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-medium text-ink">{step.label}</span>
                <span className="block truncate text-[10.5px] text-muted">{step.note}</span>
              </span>
              <ArrowRight size={12} className="text-muted transition group-hover:translate-x-0.5 group-hover:text-accent" />
            </button>
          ))}
        </div>
      </div>

      {session.reports.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-surface p-5">
          <div>
            <p className="text-[12.5px] font-medium text-ink">Latest report</p>
            <p className="mt-0.5 text-[11px] text-muted">
              {fmtDateTime(session.reports[session.reports.length - 1].created_at)} ·{" "}
              {fmtInt(session.reports[session.reports.length - 1].rows)} rows
            </p>
          </div>
          <LinkArrow>Open Reports</LinkArrow>
        </div>
      )}
    </div>
  );
}
