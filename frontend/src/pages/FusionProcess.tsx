import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  GitMerge,
  Loader2,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge, Button, ErrorPanel, ProgressBar, SectionLabel } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { fmtDuration, fmtInt, fmtNumber } from "../lib/format";
import { useSession } from "../lib/session";
import { useToast } from "../lib/toast";
import type { JobStatus, Stage } from "../lib/types";

function StageIcon({ status }: { status: Stage["status"] }) {
  if (status === "done") return <CheckCircle2 size={18} className="text-success" />;
  if (status === "running") return <Loader2 size={18} className="animate-spin text-accent" />;
  if (status === "error") return <XCircle size={18} className="text-danger" />;
  return <Circle size={18} className="text-muted/50" />;
}

function joinKeysFromPlan(status: JobStatus): Record<string, { left: string; right: string }> {
  const output: Record<string, { left: string; right: string }> = {};
  status.needs?.plan?.forEach((step) => {
    output[step.source] = { left: step.left_key, right: step.right_key };
  });
  return output;
}

export function FusionProcess() {
  const { jobId = "" } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { setSession, setJob } = useSession();
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [choice, setChoice] = useState<Record<string, { left: string; right: string }>>({});
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await api.jobStatus(jobId);
        if (cancelled) return;
        setStatus(next);
        setError(null);
        if (next.state === "awaiting_confirmation") {
          setChoice((current) => {
            if (Object.keys(current).length) return current;
            if (next.needs?.type === "confirm_keys") return joinKeysFromPlan(next);
            const manual: Record<string, { left: string; right: string }> = {};
            Object.entries(next.needs?.sources ?? {}).forEach(([source, info]) => {
              manual[source] = {
                left: info.merged_columns[0] ?? "",
                right: info.columns[0] ?? "",
              };
            });
            return manual;
          });
        }
        if (next.state === "running" || next.state === "awaiting_confirmation") {
          timer.current = window.setTimeout(poll, 900);
        }
        if (next.state === "done") {
          setSession(next.session_id);
          setJob(next.id);
        }
      } catch (caught) {
        if (cancelled) return;
        setError(caught instanceof Error ? caught.message : "Could not read the fusion job.");
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [jobId, setSession, setJob]);

  const columnsBySource = status?.needs?.columns ?? {};
  const allColumns = useMemo(() => {
    const set = new Set<string>();
    Object.values(columnsBySource).forEach((columns) => columns.forEach((column) => set.add(column)));
    status?.needs?.candidates?.forEach((candidate) => set.add(candidate.left_column));
    return Array.from(set);
  }, [columnsBySource, status]);

  const submitConfirmation = async () => {
    if (!status) return;
    const cleaned: Record<string, { left: string; right: string }> = {};
    Object.entries(choice).forEach(([source, keys]) => {
      if (keys.left && keys.right) cleaned[source] = keys;
    });
    if (!Object.keys(cleaned).length) {
      toast.show("Choose a left and right key for at least one source.", "error");
      return;
    }
    setConfirming(true);
    try {
      await api.confirmJob(status.id, { join_keys: cleaned });
      toast.show("Join keys confirmed. Merging continues.", "success");
      timer.current = window.setTimeout(async () => {
        try {
          setStatus(await api.jobStatus(jobId));
        } catch {
          /* polling effect will continue */
        }
      }, 400);
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : "Could not confirm keys.", "error");
    } finally {
      setConfirming(false);
    }
  };

  const progress = status?.state === "done" ? 100 : status?.progress ?? 0;
  const currentStage = status?.stages.find((stage) => stage.status === "running");
  const totalLogs = status?.stages.reduce((sum, stage) => sum + stage.logs.length, 0) ?? 0;

  return (
    <div className="mx-auto w-full max-w-[1000px] px-4 pb-24 sm:px-6">
      <div className="flex items-center justify-between gap-4 pb-8 pt-8">
        <Link to="/upload" className="inline-flex items-center gap-2 text-[12px] text-muted transition hover:text-ink">
          <ArrowLeft size={14} /> Back to upload
        </Link>
        <Badge tone={status?.state === "error" ? "danger" : status?.state === "done" ? "success" : "accent"}>
          {status?.state === "awaiting_confirmation"
            ? "Needs your input"
            : status?.state === "done"
              ? "Complete"
              : status?.state === "error"
                ? "Failed"
                : "Live job"}
        </Badge>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <SectionLabel>Step 02 · Fuse</SectionLabel>
          <h1 className="mt-3 font-display text-[clamp(2rem,5vw,3rem)] leading-[1.02] text-ink">
            {status?.state === "done" ? "Fusion complete." : "Fusing your sources."}
          </h1>
          <p className="mt-2 max-w-xl text-[13px] leading-relaxed text-muted">
            {status?.state === "done"
              ? "Every figure below came from this run."
              : "Live progress from the backend pipeline."}
          </p>
        </div>
        <div className="text-right">
          <p className="font-display text-[2.6rem] leading-none tracking-[-0.05em] text-ink">{progress}%</p>
          <p className="mt-1 text-[11px] text-muted">
            {status ? `${status.stages.filter((s) => s.status === "done").length} of ${status.stages.length} stages` : "connecting"}
          </p>
        </div>
      </div>

      <div className="mt-6">
        <ProgressBar value={progress} />
      </div>

      {error && (
        <div className="mt-6">
          <ErrorPanel message={error} onRetry={() => window.location.reload()} />
        </div>
      )}

      {status?.state === "done" && status.summary && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-7 rounded-card border border-success/30 bg-surface p-6"
        >
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-success/10 text-success">
                <CheckCircle2 size={21} />
              </span>
              <div>
                <h2 className="font-display text-xl text-ink">Workspace unlocked</h2>
                <p className="mt-1 text-[12.5px] text-muted">
                  {totalLogs > 0 ? `All stages finished · ${totalLogs} log lines` : "All stages finished."}
                </p>
              </div>
            </div>
            <Button onClick={() => navigate(`/workspace/${status.session_id}/dashboard`)} icon={<ArrowRight size={14} />}>
              Open Results
            </Button>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Fused rows", value: fmtInt(status.summary.rows) },
              { label: "Columns", value: fmtInt(status.summary.columns) },
              { label: "Conflicts resolved", value: fmtInt(status.summary.conflicts) },
              { label: "Fuzzy matches", value: fmtInt(status.summary.fuzzy_matches) },
            ].map((item) => (
              <div key={item.label} className="rounded-xl border border-line bg-canvas px-3.5 py-3">
                <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted">{item.label}</p>
                <p className="mt-1.5 font-display text-xl text-ink">{item.value}</p>
              </div>
            ))}
          </div>
          {status.summary.target && (
            <p className="mt-4 text-[12px] text-muted">
              Suggested target:{" "}
              <span className="font-medium text-ink">{status.summary.target.column}</span>{" "}
              <span className="text-accent">({status.summary.target.task})</span>. You can change it before training.
            </p>
          )}
        </motion.div>
      )}

      {status?.state === "error" && (
        <div className="mt-7">
          <ErrorPanel
            title="Fusion stopped"
            message={status.error ?? "The pipeline failed without a message."}
          />
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => navigate("/upload")} icon={<ArrowLeft size={13} />}>
              Back to upload
            </Button>
          </div>
        </div>
      )}

      <AnimatePresence>
        {status?.state === "awaiting_confirmation" && status.needs && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            className="mt-6 overflow-hidden"
          >
            <div className="rounded-card border border-warning/35 bg-warning/5 p-5">
              <div className="flex items-start gap-3">
                <TriangleAlert size={18} className="mt-0.5 shrink-0 text-warning" />
                <div>
                  <h3 className="font-display text-lg text-ink">Confirm the join keys</h3>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-muted">{status.needs.message}</p>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                {Object.entries(choice).map(([source, keys]) => {
                  const sourceColumns = status.needs?.columns?.[source] ?? status.needs?.sources?.[source]?.columns ?? [];
                  const leftOptions =
                    status.needs?.type === "confirm_keys"
                      ? allColumns
                      : status.needs?.sources?.[source]?.merged_columns ?? allColumns;
                  return (
                    <div key={source} className="grid gap-3 rounded-xl border border-line bg-surface p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                      <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted sm:col-span-2">
                        Source · {source}
                      </p>
                      <label className="block">
                        <span className="text-[10.5px] text-muted">Left key (merged table)</span>
                        <select
                          value={keys.left}
                          onChange={(event) =>
                            setChoice((current) => ({
                              ...current,
                              [source]: { ...keys, left: event.target.value },
                            }))
                          }
                          className="mt-1 h-10 w-full rounded-lg border border-line bg-canvas px-3 text-[12.5px] text-ink"
                        >
                          {leftOptions.map((column) => (
                            <option key={column} value={column}>
                              {column}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-[10.5px] text-muted">Right key ({source})</span>
                        <select
                          value={keys.right}
                          onChange={(event) =>
                            setChoice((current) => ({
                              ...current,
                              [source]: { ...keys, right: event.target.value },
                            }))
                          }
                          className="mt-1 h-10 w-full rounded-lg border border-line bg-canvas px-3 text-[12.5px] text-ink"
                        >
                          {sourceColumns.map((column) => (
                            <option key={column} value={column}>
                              {column}
                            </option>
                          ))}
                        </select>
                      </label>
                      <p className="hidden text-[10.5px] text-muted sm:block">→</p>
                    </div>
                  );
                })}
              </div>

              {status.needs.plan && (
                <p className="mt-3 text-[11px] text-muted">
                  Detected coverage:{" "}
                  {status.needs.plan
                    .map((step) => `${step.source} ${fmtNumber(step.coverage * 100, 0)}%`)
                    .join(" · ")}
                </p>
              )}

              <div className="mt-4">
                <Button onClick={() => void submitConfirmation()} loading={confirming} icon={<GitMerge size={14} />}>
                  Confirm keys & continue
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-8 space-y-3">
        {status?.stages.map((stage, index) => {
          const logs = stage.logs;
          return (
            <motion.div
              key={stage.key}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04 }}
              className={`rounded-card border p-4 transition-colors ${
                stage.status === "running"
                  ? "border-accent/40 bg-surface"
                  : stage.status === "error"
                    ? "border-danger/30 bg-surface"
                    : "border-line bg-surface/70"
              }`}
            >
              <div className="flex items-center gap-3">
                <StageIcon status={stage.status} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[13.5px] font-medium text-ink">{stage.label}</p>
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted">
                      {stage.status}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted">
                    {stage.logs.length
                      ? stage.logs[stage.logs.length - 1].message
                      : stage.status === "pending"
                        ? "Waiting for the previous stage."
                        : "Starting…"}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-[10px] text-muted">
                  {fmtDuration(stage.duration_ms)}
                </span>
              </div>
              {logs.length > 0 && (
                <div className="mt-3 space-y-1 border-t border-line/70 pt-3">
                  {logs.slice(-4).map((entry, logIndex) => (
                    <div key={`${entry.at}-${logIndex}`} className="flex gap-3 font-mono text-[10.5px] leading-relaxed">
                      <span className="text-muted/70">{entry.at}</span>
                      <span className="text-ink/75">{entry.message}</span>
                    </div>
                  ))}
                  {logs.length > 4 && (
                    <p className="font-mono text-[9.5px] text-muted">+ {logs.length - 4} earlier log lines</p>
                  )}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {!status && !error && (
        <div className="mt-8 flex items-center gap-3 rounded-card border border-line bg-surface p-5">
          <Loader2 size={18} className="animate-spin text-accent" />
          <p className="text-[13px] text-muted">
            Connecting to job <span className="font-mono text-ink">{jobId}</span>…
          </p>
        </div>
      )}


    </div>
  );
}
