import { AnimatePresence, motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  Plus,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  ErrorPanel,
  InfoTip,
  PageHeader,
  ProgressBar,
  SectionLabel,
} from "../components/ui";
import { ApiError, api } from "../lib/api";
import { displayCell, fmtBytes, fmtInt } from "../lib/format";
import { useSession } from "../lib/session";
import { useToast } from "../lib/toast";
import type { FileInfo, Session } from "../lib/types";

const ACCEPTED = [".csv", ".tsv", ".xlsx", ".xls", ".json"];
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_FILES = 10;

function extOf(name: string) {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

function fileKey(file: { name: string; size: number }) {
  return `${file.name.toLowerCase()}::${file.size}`;
}

function validate(files: File[]): { valid: File[]; errors: { file: string; message: string }[] } {
  const errors: { file: string; message: string }[] = [];
  const valid: File[] = [];
  for (const file of files) {
    if (!ACCEPTED.includes(extOf(file.name))) {
      errors.push({ file: file.name, message: "Unsupported format. Use CSV, TSV, XLSX, XLS or JSON." });
    } else if (file.size === 0) {
      errors.push({ file: file.name, message: "This file is empty (0 bytes)." });
    } else if (file.size > MAX_BYTES) {
      errors.push({ file: file.name, message: "Larger than the 25 MB per-file limit." });
    } else {
      valid.push(file);
    }
  }
  return { valid, errors };
}

function formatIcon(format: string) {
  if (format === "XLSX" || format === "XLS") return <FileSpreadsheet size={16} />;
  return <FileText size={16} />;
}

function FilePreview({ file }: { file: FileInfo }) {
  if (!file.preview?.length) {
    return <p className="px-4 py-3 text-[12px] text-muted">No preview rows returned for this file.</p>;
  }
  const columns = file.columns.length ? file.columns : Object.keys(file.preview[0] ?? {});
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="min-w-full border-collapse text-left">
        <thead>
          <tr className="bg-surface-2/70">
            {columns.map((column) => (
              <th
                key={column}
                className="whitespace-nowrap border-b border-line px-3 py-2 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted"
              >
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {file.preview.map((row, index) => (
            <tr key={index} className="border-b border-line/60 last:border-0">
              {columns.map((column) => (
                <td key={column} className="max-w-[220px] truncate whitespace-nowrap px-3 py-2 text-[12px] text-ink/85">
                  {displayCell(row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SourceCard({
  file,
  open,
  removing,
  onToggle,
  onRemove,
}: {
  file: FileInfo;
  open: boolean;
  removing: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-card border border-line bg-surface">
      <div className="flex flex-wrap items-start gap-3 p-4">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-line bg-canvas text-accent">
          {formatIcon(file.format)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 truncate text-[13.5px] font-medium text-ink">{file.name}</p>
            <Badge>{file.format}</Badge>
          </div>
          <p className="mt-1 text-[11.5px] text-muted">
            {fmtInt(file.rows)} rows × {file.cols} columns · {fmtBytes(file.size)} ·{" "}
            <span className="font-mono text-[10.5px]">{file.source}</span>
          </p>
          {file.warnings.map((warning) => (
            <p key={warning} className="mt-1 flex items-start gap-1.5 text-[11.5px] text-warning">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {warning}
            </p>
          ))}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            className="flex h-8 items-center gap-1 rounded-full border border-line px-3 text-[11px] text-muted transition hover:border-accent/60 hover:text-accent"
          >
            Preview
            <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          <button
            type="button"
            aria-label={`Remove ${file.name}`}
            disabled={removing}
            onClick={onRemove}
            className="flex h-8 w-8 items-center justify-center rounded-full text-muted transition hover:bg-danger/10 hover:text-danger disabled:opacity-50"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.26 }}
            className="overflow-hidden"
          >
            <div className="border-t border-line p-3">
              <FilePreview file={file} />
              <p className="mt-2 px-1 text-[10.5px] text-muted">First 5 rows, parsed by the backend.</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function UploadPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { sessionId, setSession: saveSession, setJob } = useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [errors, setErrors] = useState<{ file: string; message: string }[]>([]);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  // The last session id this page created or read successfully.
  const confirmed = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      setRestoreError(null);
      return;
    }
    let cancelled = false;
    setLoadingExisting(true);
    setRestoreError(null);
    api
      .session(sessionId)
      .then((value) => {
        if (cancelled) return;
        setSession(value);
        confirmed.current = value.id;
        setExpanded((current) => current ?? value.files[0]?.id ?? null);
      })
      .catch((caught) => {
        if (cancelled) return;
        const gone = caught instanceof ApiError && caught.status === 404;
        // Only a 404 means the session is genuinely unavailable. A network
        // error or a 5xx must not throw away the reference to the user's data.
        if (!gone) {
          setRestoreError(
            caught instanceof Error ? caught.message : "Could not restore this session from the API.",
          );
          return;
        }
        if (confirmed.current === sessionId) {
          // We just uploaded into this session, so the files exist; the API
          // simply cannot read them back for this browser. Say so instead of
          // silently showing zero files.
          setRestoreError(
            "The API did not recognise this browser's session token, so it could not reload the files you just uploaded. Reload once the frontend and API are on matching deployments.",
          );
          return;
        }
        saveSession(null);
        setSession(null);
        setRestoreError("That session is no longer available. Upload a file to start a new one.");
      })
      .finally(() => {
        if (!cancelled) setLoadingExisting(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const handleFiles = async (fileList: FileList | File[] | null) => {
    const incoming = fileList ? Array.from(fileList) : [];
    if (!incoming.length) return;
    setGeneralError(null);

    const { valid, errors: invalid } = validate(incoming);
    const current = session?.files ?? [];
    const known = new Set(current.map(fileKey));
    const batch = new Set<string>();
    const accepted: File[] = [];
    const rejected = [...invalid];

    for (const file of valid) {
      const key = fileKey(file);
      if (known.has(key)) {
        rejected.push({ file: file.name, message: "Already uploaded in this session." });
      } else if (batch.has(key)) {
        rejected.push({ file: file.name, message: "Selected twice in this batch." });
      } else if (current.length + accepted.length >= MAX_FILES) {
        rejected.push({ file: file.name, message: `A session holds at most ${MAX_FILES} sources.` });
      } else {
        batch.add(key);
        accepted.push(file);
      }
    }

    setErrors(rejected);
    if (!accepted.length) {
      if (inputRef.current) inputRef.current.value = "";
      return;
    }

    setUploading(true);
    setProgress(0);
    setPending(accepted.map((file) => file.name));
    try {
      const onProgress = (value: { percent: number }) => setProgress(value.percent);
      const result = session
        ? await api.addFiles(session.id, accepted, onProgress)
        : await api.upload(accepted, onProgress);
      setSession(result.session);
      saveSession(result.session.id);
      confirmed.current = result.session.id;
      setRestoreError(null);
      setExpanded(result.files[0]?.id ?? null);
      toast.show(
        `${result.files.length} file${result.files.length === 1 ? "" : "s"} added · ${fmtInt(
          result.session.files.reduce((sum, file) => sum + file.rows, 0),
        )} rows in session`,
        "success",
      );
      if (result.warning) toast.show(result.warning, "info");
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.errors ?? []);
        setGeneralError(error.message);
      } else {
        setGeneralError("Upload failed unexpectedly.");
      }
    } finally {
      setUploading(false);
      setProgress(null);
      setPending([]);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    void handleFiles(event.dataTransfer.files);
  };

  const removeFile = async (file: FileInfo) => {
    if (!session) return;
    setRemoving(file.id);
    setErrors([]);
    setGeneralError(null);
    try {
      const result = await api.removeFile(session.id, file.id);
      setSession(result.session);
      if (!result.files.length) {
        saveSession(null);
        setSession(null);
      }
      toast.show(`${file.name} removed from this session.`, "info");
    } catch (error) {
      toast.show(error instanceof Error ? error.message : "Could not remove the file.", "error");
    } finally {
      setRemoving(null);
    }
  };

  const reset = async () => {
    if (session) {
      try {
        await api.deleteSession(session.id);
      } catch {
        /* session may already be gone */
      }
    }
    saveSession(null);
    setJob(null);
    setSession(null);
    confirmed.current = null;
    setErrors([]);
    setGeneralError(null);
    setRestoreError(null);
    setExpanded(null);
  };

  const startFusion = async () => {
    if (!session || !session.files.length) return;
    setStarting(true);
    setGeneralError(null);
    try {
      const result = await api.startFusion(session.id);
      setJob(result.job_id);
      navigate(`/fusion/${result.job_id}`);
    } catch (error) {
      setGeneralError(error instanceof Error ? error.message : "Could not start fusion.");
      setStarting(false);
    }
  };

  const ready = session?.status === "ready";
  const fileCount = session?.files.length ?? 0;
  const totalRows = session?.files.reduce((sum, file) => sum + file.rows, 0) ?? 0;
  const openPicker = () => inputRef.current?.click();

  return (
    <div className="mx-auto w-full max-w-[1180px] px-4 pb-20 sm:px-6 lg:px-8">
      <PageHeader
        eyebrow="Step 01 · Collect"
        title="Your sources, side by side."
        description={`Add two or more related files. CSV, TSV, XLSX, XLS or JSON · up to ${MAX_FILES} files · 25 MB each.`}
        actions={
          session ? (
            <Button variant="ghost" size="sm" onClick={reset} icon={<X size={13} />}>
              Start over
            </Button>
          ) : undefined
        }
      />

      {loadingExisting && <p className="pb-4 text-[12px] text-muted">Restoring your last session…</p>}

      {restoreError && (
        <div className="pb-4">
          <ErrorPanel title="Session sync" message={restoreError} />
        </div>
      )}

      {ready && session && (
        <div className="mb-5 flex flex-col gap-3 rounded-card border border-success/30 bg-success/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-success/10 text-success">
              <Sparkles size={15} />
            </span>
            <div>
              <p className="text-[13px] font-medium text-ink">This session is already fused.</p>
              <p className="text-[12px] text-muted">
                {fmtInt(session.fusion?.final_rows ?? 0)} rows × {session.fusion?.final_columns ?? 0} columns.
                Adding sources resets the fusion.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={reset}>
              New session
            </Button>
            <Button
              size="sm"
              onClick={() => navigate(`/workspace/${session.id}/dashboard`)}
              icon={<ArrowRight size={13} />}
            >
              Open results
            </Button>
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.65fr_1fr]">
        <div
          className="space-y-4"
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
          }}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED.join(",")}
            className="sr-only"
            onChange={(event) => void handleFiles(event.target.files)}
          />

          <div
            className={`rounded-card border border-dashed transition-all duration-300 ${
              dragging ? "border-accent bg-accent-soft/50" : "border-line bg-surface hover:border-accent/50"
            }`}
          >
            {session ? (
              <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-canvas text-accent">
                    <UploadCloud size={18} />
                  </span>
                  <div>
                    <p className="text-[13px] font-medium text-ink">Drop more files to add sources</p>
                    <p className="text-[11.5px] text-muted">
                      Existing files stay in the session. Select several with Ctrl or Shift.
                    </p>
                  </div>
                </div>
                <Button
                  onClick={openPicker}
                  loading={uploading}
                  icon={uploading ? undefined : <Plus size={15} />}
                  className="shrink-0"
                >
                  {uploading ? "Uploading…" : "Add file"}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-line bg-canvas text-accent">
                  <UploadCloud size={24} />
                </span>
                <h2 className="mt-5 font-display text-xl text-ink">Drop datasets here</h2>
                <p className="mt-2 max-w-sm text-[12.5px] leading-relaxed text-muted">
                  CSV, TSV, XLSX, XLS or JSON · header row required. Select multiple files at once with Ctrl or Shift.
                </p>
                <Button
                  className="mt-6"
                  size="lg"
                  onClick={openPicker}
                  loading={uploading}
                  icon={uploading ? undefined : <Plus size={16} />}
                >
                  {uploading ? "Uploading…" : "Add files"}
                </Button>
                <p className="mt-4 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.16em] text-muted">
                  Files stay on this machine
                  <InfoTip label="Upload limits" align="center">
                    Up to {MAX_FILES} files per session and 25 MB per file. Supported formats: CSV, TSV, XLSX, XLS and
                    JSON. Each file needs a header row and at least one data row.
                  </InfoTip>
                </p>
              </div>
            )}
          </div>

          {uploading && (
            <div className="rounded-card border border-line bg-surface p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-[12.5px] font-medium text-ink">
                  Uploading {pending.length} file{pending.length === 1 ? "" : "s"}
                  <span className="ml-1.5 font-normal text-muted">{pending.join(", ")}</span>
                </p>
                <span className="shrink-0 font-mono text-[11px] text-accent">{progress === null ? "" : `${progress}%`}</span>
              </div>
              <ProgressBar value={progress ?? 0} className="mt-3" />
              <p className="mt-2 text-[10.5px] text-muted">Parsing and profiling with the backend…</p>
            </div>
          )}

          {session && fileCount > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-1">
              <SectionLabel>
                {fileCount} source{fileCount === 1 ? "" : "s"} · {fmtInt(totalRows)} rows
              </SectionLabel>
              <div className="flex items-center gap-2">
                <Badge tone={fileCount >= 2 ? "success" : "warning"}>
                  {fileCount >= 2 ? "Fusion ready" : "Add one more"}
                </Badge>
                <button
                  type="button"
                  onClick={openPicker}
                  className="inline-flex h-7 items-center gap-1 rounded-full border border-line px-2.5 text-[10.5px] text-muted transition hover:border-accent/60 hover:text-accent"
                >
                  <Plus size={11} /> Add file
                </button>
              </div>
            </div>
          )}

          {session?.files.map((file) => (
            <SourceCard
              key={file.id}
              file={file}
              open={expanded === file.id}
              removing={removing === file.id}
              onToggle={() => setExpanded(expanded === file.id ? null : file.id)}
              onRemove={() => void removeFile(file)}
            />
          ))}

          {fileCount === 1 && (
            <p className="flex items-start gap-2 px-1 text-[11.5px] leading-relaxed text-muted">
              <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warning" />
              One file works for cleaning and analysis; fusion needs at least two.
            </p>
          )}

          {(errors.length > 0 || generalError) && (
            <div className="space-y-2">
              {errors.map((error) => (
                <ErrorPanel key={`${error.file}-${error.message}`} title={error.file} message={error.message} />
              ))}
              {generalError && errors.length === 0 && <ErrorPanel message={generalError} />}
            </div>
          )}
        </div>

        <aside className="h-fit space-y-4 lg:sticky lg:top-[112px]">
          <div className="rounded-card border border-line bg-surface p-5">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-muted">Session totals</p>
              <Badge tone="accent">{fileCount} files</Badge>
            </div>
            <p className="mt-3 font-display text-[2.4rem] leading-none tracking-[-0.04em] text-ink">
              {fmtInt(totalRows)}
            </p>
            <p className="mt-1 text-[11px] text-muted">rows across uploaded files</p>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-line bg-canvas px-3 py-2">
                <p className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-muted">Sources</p>
                <p className="mt-0.5 text-[13px] text-ink">{fileCount}</p>
              </div>
              <div className="rounded-xl border border-line bg-canvas px-3 py-2">
                <p className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-muted">Columns</p>
                <p className="mt-0.5 text-[13px] text-ink">
                  {session?.files.reduce((sum, file) => sum + file.cols, 0) ?? 0}
                </p>
              </div>
            </div>

            <Button
              className="mt-4 w-full"
              size="lg"
              onClick={() => void startFusion()}
              disabled={!fileCount || uploading}
              loading={starting}
              icon={<Sparkles size={15} />}
            >
              Start Fusion
            </Button>
            <p className="mt-2.5 text-center text-[10.5px] text-muted">
              {fileCount >= 2 ? "Fuses every source above." : "Add at least two sources to fuse."}
            </p>
          </div>

          <details className="group rounded-card border border-line bg-surface px-5 py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-[12px] font-medium text-ink">
              What Start Fusion does
              <ChevronDown size={14} className="text-muted transition-transform group-open:rotate-180" />
            </summary>
            <ol className="mt-3 space-y-2 border-t border-line pt-3">
              {[
                "Cleans every source and logs each action.",
                "Detects shared keys and fuzzy-links what keys miss.",
                "Resolves conflicts, then unlocks the workspace.",
              ].map((item, index) => (
                <li key={item} className="flex gap-2.5 text-[11.5px] leading-relaxed text-muted">
                  <span className="font-mono text-[9.5px] text-accent">0{index + 1}</span>
                  {item}
                </li>
              ))}
            </ol>
          </details>
        </aside>
      </div>
    </div>
  );
}
