import { motion } from "framer-motion";
import {
  ArrowUpRight,
  CheckCircle2,
  Clock3,
  Database,
  History,
  Loader2,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge, Button, EmptyState, ErrorPanel, PageHeader, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import { fmtDateTime, fmtInt, timeAgo } from "../lib/format";
import { useSession } from "../lib/session";
import { useToast } from "../lib/toast";
import type { HistoryItem } from "../lib/types";

function statusBadge(status: string) {
  if (status === "ready") return <Badge tone="success">Ready</Badge>;
  if (status === "fusing") return <Badge tone="accent">Fusing</Badge>;
  if (status === "error") return <Badge tone="danger">Failed</Badge>;
  return <Badge>Uploaded</Badge>;
}

export function HistoryPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { setSession, setJob } = useSession();
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = () => {
    setError(null);
    api
      .history()
      .then(setItems)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load history."));
  };

  useEffect(load, []);

  const open = (item: HistoryItem) => {
    setSession(item.id);
    if (item.status === "ready") {
      navigate(`/workspace/${item.id}/dashboard`);
      return;
    }
    api
      .session(item.id)
      .then((session) => {
        if (session.job_id) {
          setJob(session.job_id);
          navigate(`/fusion/${session.job_id}`);
        } else {
          navigate("/upload");
        }
      })
      .catch(() => navigate("/upload"));
  };

  const remove = async () => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await api.deleteSession(deleteId);
      setItems((current) => current?.filter((item) => item.id !== deleteId) ?? null);
      setDeleteId(null);
      toast.show("Session and its stored artefacts were deleted.", "success");
    } catch (caught) {
      toast.show(caught instanceof Error ? caught.message : "Could not delete the session.", "error");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-20 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Workspace archive"
        title="Every run, kept on disk."
        description="Reopen a finished fusion, resume a running job, or delete a session with its uploads, model and reports."
        actions={
          <Button variant="secondary" size="sm" onClick={load} icon={<History size={13} />}>
            Refresh
          </Button>
        }
      />

      {error && <ErrorPanel message={error} onRetry={load} className="mb-5" />}

      {items === null && !error && (
        <div className="space-y-3">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-20 w-full rounded-card" />
          ))}
        </div>
      )}

      {items && items.length === 0 && (
        <EmptyState
          icon={<Database size={20} />}
          title="No sessions yet"
          description="Upload two or more of your own datasets to start a fusion."
          action={
            <Button size="sm" onClick={() => navigate("/upload")} icon={<ArrowUpRight size={13} />}>
              Upload datasets
            </Button>
          }
        />
      )}

      {items && items.length > 0 && (
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          <div className="hidden grid-cols-[2.2fr_1fr_1.5fr_1.2fr_1fr_auto] gap-4 border-b border-line bg-surface-2/50 px-5 py-3 font-mono text-[9px] uppercase tracking-[0.14em] text-muted md:grid">
            <span>Session</span>
            <span>Status</span>
            <span>Rows × features</span>
            <span>Created</span>
            <span>Model</span>
            <span />
          </div>
          <div className="divide-y divide-line">
            {items.map((item, index) => (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.03 }}
                className="group grid gap-3 px-5 py-4 transition hover:bg-surface-2/40 md:grid-cols-[2.2fr_1fr_1.5fr_1.2fr_1fr_auto] md:items-center md:gap-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-ink">{item.name}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-muted">
                    {item.file_count} source{item.file_count === 1 ? "" : "s"} ·{" "}
                    <span title={fmtDateTime(item.created_at)}>{timeAgo(item.created_at)}</span>
                  </p>
                </div>
                <div>{statusBadge(item.status)}</div>
                <div className="text-[12px] text-ink/80">
                  {item.rows !== null ? (
                    <>
                      {fmtInt(item.rows)} × {fmtInt(item.features)}
                      <span className="ml-1.5 text-[10.5px] text-muted">
                        {item.target ? `· target ${item.target}` : ""}
                      </span>
                    </>
                  ) : (
                    <span className="text-muted">Not fused</span>
                  )}
                </div>
                <div className="text-[11.5px] text-muted">{fmtDateTime(item.created_at)}</div>
                <div className="text-[11.5px]">
                  {item.best_model ? (
                    <span className="inline-flex items-center gap-1.5 text-ink/80">
                      <CheckCircle2 size={12} className="text-success" /> {item.best_model}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-muted">
                      <Clock3 size={12} /> Not trained
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => open(item)}
                    className="inline-flex h-8 items-center gap-1 rounded-full border border-line px-3 text-[11px] text-ink transition hover:border-accent hover:text-accent"
                  >
                    Open <ArrowUpRight size={11} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${item.name}`}
                    onClick={() => setDeleteId(item.id)}
                    className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {deleteId && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="w-full max-w-sm rounded-card border border-line bg-surface p-5 shadow-lift"
            role="dialog"
            aria-modal="true"
            aria-label="Delete session"
          >
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-danger/10 text-danger">
                <TriangleAlert size={16} />
              </span>
              <div>
                <h3 className="font-display text-lg text-ink">Delete this session?</h3>
                <p className="mt-1 text-[12px] leading-relaxed text-muted">
                  Uploads, fused data, the model and reports are deleted from disk. This cannot be undone.
                </p>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDeleteId(null)} disabled={deleting}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void remove()} loading={deleting} className="bg-danger text-white hover:bg-danger/90">
                Delete session
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
