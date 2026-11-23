import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  FileUp,
  Loader2,
  Sparkles,
  Wand2,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Badge, Button, EmptyState, ErrorPanel, StepHeader } from "../../components/ui";
import { ApiError, api, apiUrl } from "../../lib/api";
import { displayCell, fmtNumber } from "../../lib/format";
import { useToast } from "../../lib/toast";
import type { BatchResponse, PredictField, PredictResponse, Session } from "../../lib/types";

type Values = Record<string, string>;

function initialValues(fields: PredictField[]): Values {
  const values: Values = {};
  fields.forEach((field) => {
    if (field.kind === "numeric") values[field.name] = String(field.median ?? 0);
    else values[field.name] = field.options?.[0] ?? "";
  });
  return values;
}

export function PredictTab({
  session,
  onNavigate,
}: {
  session: Session;
  onNavigate: (key: "train") => void;
}) {
  const toast = useToast();
  const model = session.model;
  const fields = model?.schema ?? [];
  const [values, setValues] = useState<Values>(() => initialValues(fields));
  const [result, setResult] = useState<PredictResponse | null>(null);
  const [predicting, setPredicting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batchFile, setBatchFile] = useState<File | null>(null);
  const [batch, setBatch] = useState<BatchResponse | null>(null);
  const [batching, setBatching] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const numericFields = useMemo(() => fields.filter((field) => field.kind === "numeric"), [fields]);

  if (!model) {
    return (
      <EmptyState
        icon={<BrainCircuit size={20} />}
        title="No trained model for this session"
        description="Prediction uses the winning model. Train one first."
        action={
          <Button size="sm" onClick={() => onNavigate("train")} icon={<ArrowRight size={13} />}>
            Go to Train Models
          </Button>
        }
      />
    );
  }

  if (!fields.length) {
    return (
      <ErrorPanel
        title="Prediction schema unavailable"
        message="The saved model does not expose a feature schema. Retrain the model to rebuild it."
      />
    );
  }

  const submit = async () => {
    setPredicting(true);
    setError(null);
    try {
      const response = await api.predict(session.id, values);
      setResult(response);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Prediction failed.");
    } finally {
      setPredicting(false);
    }
  };

  const submitBatch = async () => {
    if (!batchFile) return;
    setBatching(true);
    setBatchError(null);
    try {
      const response = await api.predictBatch(session.id, batchFile);
      setBatch(response);
      toast.show(`Scored ${response.total} rows with ${model.best_model}.`, "success");
    } catch (caught) {
      setBatchError(caught instanceof ApiError ? caught.message : "Batch prediction failed.");
    } finally {
      setBatching(false);
    }
  };

  const prediction = result?.predictions[0];
  const probabilities = prediction?.probabilities
    ? Object.entries(prediction.probabilities).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <div className="space-y-6">
      <StepHeader
        step="Step 08 · Predict"
        title="Score new records."
        description={
          <>
            Using <span className="text-ink">{model.best_model}</span> for target{" "}
            <span className="text-ink">{model.target}</span> ({model.task}). Defaults are training medians.
          </>
        }
      />

      <div className="grid items-start gap-5 xl:grid-cols-[1.35fr_1fr]">
        <div className="rounded-card border border-line bg-surface p-5">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-[15.5px] text-ink">Feature values</h2>
            <Badge>{fields.length} inputs</Badge>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {fields.map((field) => (
              <label key={field.name} className="block min-w-0">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 break-all font-mono text-[10px] leading-tight text-ink/75">{field.name}</span>
                  <span className="shrink-0 font-mono text-[8.5px] uppercase tracking-[0.1em] text-muted">{field.kind}</span>
                </span>
                {field.kind === "numeric" ? (
                  <input
                    type="number"
                    value={values[field.name] ?? ""}
                    step={field.step ?? 1}
                    min={field.min}
                    max={field.max}
                    onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                    className="mt-1 h-10 w-full rounded-lg border border-line bg-canvas px-3 text-[12px] text-ink outline-none focus:border-accent"
                  />
                ) : (
                  <select
                    value={values[field.name] ?? ""}
                    onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                    className="mt-1 h-10 w-full rounded-lg border border-line bg-canvas px-2.5 text-[12px] text-ink outline-none focus:border-accent"
                  >
                    <option value="">Unused / unknown</option>
                    {(field.options ?? []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                )}
              </label>
            ))}
          </div>
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button onClick={() => void submit()} loading={predicting} icon={<Wand2 size={14} />}>
              Predict this record
            </Button>
            <span className="text-[10.5px] text-muted">
              {numericFields.length} numeric · {fields.length - numericFields.length} categorical inputs
            </span>
          </div>
        </div>

        <div className="rounded-card border border-line bg-surface p-5">
          <h2 className="font-display text-[15.5px] text-ink">Prediction</h2>
          <AnimatePresence mode="wait">
            {prediction ? (
              <motion.div
                key={`${prediction.prediction}-${prediction.confidence ?? ""}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="mt-4"
              >
                <div className="rounded-xl border border-accent/30 bg-accent-soft/40 p-4">
                  <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted">Predicted {result?.target}</p>
                  <p className="mt-1.5 font-display text-3xl leading-none tracking-[-0.04em] text-ink">
                    {displayCell(prediction.prediction)}
                  </p>
                  {prediction.confidence !== undefined && (
                    <p className="mt-2 text-[11px] text-muted">
                      Confidence {fmtNumber(prediction.confidence * 100, 1)}% · {model.best_model}
                    </p>
                  )}
                </div>
                {probabilities.length > 0 && (
                  <div className="mt-4 space-y-2">
                    <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted">Class probabilities</p>
                    {probabilities.map(([label, value]) => (
                      <div key={label}>
                        <div className="flex justify-between text-[10.5px]">
                          <span className="text-ink/80">{label}</span>
                          <span className="font-mono text-muted">{fmtNumber(value * 100, 1)}%</span>
                        </div>
                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${value * 100}%` }}
                            transition={{ duration: 0.5 }}
                            className="h-full rounded-full bg-accent"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <p className="mt-4 flex items-start gap-1.5 text-[10px] leading-relaxed text-muted">
                  <CheckCircle2 size={11} className="mt-0.5 shrink-0 text-success" />
                  Scored by the saved pipeline.
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="mt-6 flex h-[220px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-center"
              >
                <Sparkles size={18} className="text-muted" />
                <p className="max-w-xs text-[11.5px] leading-relaxed text-muted">
                  Run a prediction to see the result.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
          {error && <ErrorPanel message={error} className="mt-4" />}
        </div>
      </div>

      <div className="rounded-card border border-line bg-surface p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-[15.5px] text-ink">Batch prediction</h2>
            <p className="mt-1 max-w-xl text-[11.5px] leading-relaxed text-muted">
              CSV with the {fields.length} feature columns ({fields.slice(0, 4).map((field) => field.name).join(", ")}
              {fields.length > 4 ? ", …" : ""}). Extra columns are kept in the download.
            </p>
          </div>
          <Badge>max 5,000 rows</Badge>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv"
          className="sr-only"
          onChange={(event) => {
            setBatchFile(event.target.files?.[0] ?? null);
            setBatch(null);
            setBatchError(null);
          }}
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} icon={<FileUp size={13} />}>
            {batchFile ? batchFile.name : "Choose batch CSV"}
          </Button>
          <Button size="sm" onClick={() => void submitBatch()} disabled={!batchFile} loading={batching}>
            {batching ? "Scoring rows…" : "Run batch"}
          </Button>
          {batch && (
            <a href={apiUrl(batch.download)}>
              <Button size="sm" variant="subtle">
                Download predictions CSV
              </Button>
            </a>
          )}
        </div>
        {batchError && <ErrorPanel message={batchError} className="mt-4" />}
        {batching && (
          <p className="mt-4 flex items-center gap-2 text-[11px] text-muted">
            <Loader2 size={13} className="animate-spin text-accent" /> The backend is scoring every uploaded row.
          </p>
        )}
        {batch && batch.preview.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-xl border border-line">
            <table className="min-w-full text-left">
              <thead className="bg-surface-2/60">
                <tr>
                  {Object.keys(batch.preview[0]).slice(0, 8).map((column) => (
                    <th
                      key={column}
                      className="whitespace-nowrap border-b border-line px-3 py-2 font-mono text-[9px] uppercase tracking-[0.1em] text-muted"
                    >
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {batch.preview.slice(0, 15).map((row, index) => (
                  <tr key={index} className="border-b border-line/60 last:border-0">
                    {Object.keys(batch.preview[0]).slice(0, 8).map((column) => (
                      <td key={column} className="max-w-[200px] truncate whitespace-nowrap px-3 py-2 text-[11px] text-ink/80">
                        {displayCell(row[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-line px-3 py-2 text-[10px] text-muted">
              Showing {Math.min(15, batch.preview.length)} of {batch.total} scored rows. The download contains all rows.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
