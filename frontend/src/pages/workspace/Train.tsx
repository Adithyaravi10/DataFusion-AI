import { motion } from "framer-motion";
import { BrainCircuit, CheckCircle2, Loader2, Sparkles, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import {
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge, Button, ErrorPanel, InfoTip, Skeleton, StepHeader } from "../../components/ui";
import { ApiError, api } from "../../lib/api";
import { fmtNumber } from "../../lib/format";
import { useChartPalette } from "../../lib/theme";
import { useToast } from "../../lib/toast";
import type { AnalyseResponse, MetricsRow, ModelSummary, Session } from "../../lib/types";

function metricCells(row: MetricsRow, task: "classification" | "regression") {
  if (task === "classification") {
    return [
      fmtNumber(row.accuracy, 3),
      fmtNumber(row.precision, 3),
      fmtNumber(row.recall, 3),
      fmtNumber(row.f1, 3),
      `${fmtNumber(row.cv_f1_mean, 3)} ± ${fmtNumber(row.cv_f1_std, 3)}`,
    ];
  }
  return [
    fmtNumber(row.r2, 3),
    fmtNumber(row.mae, 2),
    fmtNumber(row.rmse, 2),
    `${fmtNumber(row.cv_r2_mean, 3)} ± ${fmtNumber(row.cv_r2_std, 3)}`,
    "",
  ];
}

export function TrainTab({
  session,
  onRefresh,
}: {
  session: Session;
  onRefresh: () => Promise<void> | void;
}) {
  const toast = useToast();
  const palette = useChartPalette();
  const [analysis, setAnalysis] = useState<AnalyseResponse | null>(null);
  const [target, setTarget] = useState(session.target?.column ?? "");
  const [testSize, setTestSize] = useState(0.25);
  const [cvFolds, setCvFolds] = useState(5);
  const [training, setTraining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trained, setTrained] = useState<ModelSummary | null>(null);
  const [loadingModel, setLoadingModel] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .analyse(session.id)
      .then((value) => {
        if (cancelled) return;
        setAnalysis(value);
        if (!value.overview.some((row) => row.feature === target)) {
          setTarget(value.target?.column ?? value.overview[0]?.feature ?? "");
        }
      })
      .catch(() => {
        if (!cancelled) setAnalysis(null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  useEffect(() => {
    let cancelled = false;
    setLoadingModel(true);
    api
      .model(session.id)
      .then((value) => {
        if (!cancelled) setTrained(value.model);
      })
      .catch(() => {
        if (!cancelled) setTrained(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingModel(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session.id]);

  const targetRow = analysis?.overview.find((row) => row.feature === target);
  const likelyTask =
    targetRow && targetRow.type === "Numeric" && targetRow.unique > 10 ? "regression" : "classification";

  const run = async () => {
    if (!target) {
      toast.show("Choose a target column first.", "error");
      return;
    }
    setTraining(true);
    setError(null);
    try {
      const result = await api.train(session.id, { target, test_size: testSize, cv_folds: cvFolds });
      setTrained(result.model);
      toast.show(`Trained four models. Best: ${result.model.best_model}.`, "success");
      await onRefresh();
    } catch (caught) {
      const message = caught instanceof ApiError ? caught.message : caught instanceof Error ? caught.message : "Training failed.";
      setError(message);
    } finally {
      setTraining(false);
    }
  };

  const evaluation = trained?.evaluation;
  const metrics = trained?.metrics_table ?? evaluation?.metrics_table ?? [];
  const task: "classification" | "regression" =
    trained?.task ?? (likelyTask as "classification" | "regression");
  const bestName = trained?.best_model;
  const confusion = trained?.confusion_matrix ?? evaluation?.confusion_matrix ?? null;
  const points = evaluation?.actual_vs_predicted ?? [];
  const importance = trained?.feature_importance ?? evaluation?.feature_importance ?? [];

  return (
    <div className="space-y-6">
      <StepHeader
        step="Step 06 · Train & evaluate"
        title="Four models. One dataset. Honest metrics."
        description="Fixed seed 42 · train/test split + k-fold CV. The same inputs always give the same numbers."
        actions={
          trained ? (
            <Badge tone="success">
              <CheckCircle2 size={11} /> {trained.best_model} saved
            </Badge>
          ) : undefined
        }
      />

      <div className="rounded-card border border-line bg-surface p-5">
        {analysis ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 lg:items-end">
            <label className="block sm:col-span-2">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">Target column</span>
              <select
                value={target}
                onChange={(event) => setTarget(event.target.value)}
                className="mt-1.5 h-11 w-full rounded-xl border border-line bg-canvas px-3 text-[12.5px] text-ink outline-none focus:border-accent"
              >
                {analysis.overview.map((row) => (
                  <option key={row.feature} value={row.feature}>
                    {row.feature} · {row.type.toLowerCase()} · {row.unique} unique
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">Test split</span>
              <select
                value={testSize}
                onChange={(event) => setTestSize(Number(event.target.value))}
                className="mt-1.5 h-11 w-full rounded-xl border border-line bg-canvas px-3 text-[12.5px] text-ink outline-none focus:border-accent"
              >
                {[0.15, 0.2, 0.25, 0.3, 0.4].map((value) => (
                  <option key={value} value={value}>
                    {Math.round((1 - value) * 100)} / {Math.round(value * 100)}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted">CV folds</span>
              <select
                value={cvFolds}
                onChange={(event) => setCvFolds(Number(event.target.value))}
                className="mt-1.5 h-11 w-full rounded-xl border border-line bg-canvas px-3 text-[12.5px] text-ink outline-none focus:border-accent"
              >
                {[3, 5, 10].map((value) => (
                  <option key={value} value={value}>
                    {value}-fold
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <Skeleton className="h-24 w-full rounded-xl" />
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <Badge tone="accent">{likelyTask}</Badge>
            <span className="flex items-center gap-1.5">
              Inferred from the target's values
              <InfoTip label="How the task is chosen">
                A numeric target with more than 10 distinct values is treated as regression; everything else is
                classification. The same four-model comparison runs either way.
              </InfoTip>
            </span>
          </div>
          <Button onClick={() => void run()} loading={training} disabled={!analysis} icon={<BrainCircuit size={15} />}>
            {training ? "Training & cross-validating…" : "Train four models"}
          </Button>
        </div>
      </div>

      {error && <ErrorPanel title="Training failed" message={error} />}

      {training && (
        <div className="flex items-center gap-3 rounded-card border border-line bg-surface p-5">
          <Loader2 size={18} className="animate-spin text-accent" />
          <div>
            <p className="text-[12.5px] font-medium text-ink">Fitting Random Forest, Decision Tree, Logistic/SVM models…</p>
            <p className="text-[11px] text-muted">
              The backend is running {cvFolds}-fold CV and a {Math.round(testSize * 100)}% hold-out test. Duration is
              measured per model.
            </p>
          </div>
        </div>
      )}

      {loadingModel && !trained && <Skeleton className="h-48 rounded-card" />}

      {trained && metrics.length > 0 && (
        <>
          <div className="rounded-card border border-line bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-4">
              <div>
                <h2 className="font-display text-[15.5px] text-ink">Model comparison</h2>
                <p className="text-[10.5px] text-muted">
                  Target {trained.target} · {trained.task} ·{" "}
                  {evaluation ? `${evaluation.n_train} train / ${evaluation.n_test} test rows` : "test split + CV"}
                </p>
              </div>
              <Badge>{task === "classification" ? "weighted F1 selects the winner" : "R² selects the winner"}</Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="bg-surface-2/50">
                    {(task === "classification"
                      ? ["Model", "Accuracy", "Precision", "Recall", "F1", "CV F1 (mean ± std)", "Fit"]
                      : ["Model", "R²", "MAE", "RMSE", "CV R² (mean ± std)", "", "Fit"]
                    ).map((header, index) => (
                      <th
                        key={`${header}-${index}`}
                        className="whitespace-nowrap border-b border-line px-4 py-2.5 font-mono text-[9px] uppercase tracking-[0.1em] text-muted"
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {metrics.map((row) => {
                    const isBest = row.model === bestName;
                    const cells = metricCells(row, task);
                    return (
                      <tr
                        key={row.model}
                        className={`border-b border-line/60 last:border-0 ${
                          isBest ? "bg-accent-soft/50" : "hover:bg-surface-2/30"
                        }`}
                      >
                        <td className="whitespace-nowrap px-4 py-3 text-[12px] text-ink">
                          <span className="flex items-center gap-2">
                            {row.model}
                            {isBest && <Badge tone="accent">Best</Badge>}
                          </span>
                        </td>
                        {cells.map((cell, index) =>
                          cell ? (
                            <td key={index} className="whitespace-nowrap px-4 py-3 font-mono text-[11px] text-ink/80">
                              {cell}
                            </td>
                          ) : (
                            <td key={index} />
                          ),
                        )}
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-[10.5px] text-muted">
                          {row.duration_s}s
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1.1fr_1fr]">
            <div className="rounded-card border border-accent/30 bg-accent-soft/30 p-5">
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="text-accent" />
                <p className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-accent">Selected model</p>
              </div>
              <h3 className="mt-2 font-display text-2xl text-ink">{trained.best_model}</h3>
              <p className="mt-2 text-[12px] leading-relaxed text-ink/75">{trained.reason}</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {Object.entries(trained.best_metrics ?? {})
                  .filter(([key, value]) => typeof value === "number" && !key.endsWith("_std"))
                  .slice(0, 6)
                  .map(([key, value]) => (
                    <div key={key} className="rounded-lg border border-line bg-surface px-3 py-2">
                      <p className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-muted">
                        {key.replace(/_/g, " ")}
                      </p>
                      <p className="mt-0.5 font-display text-[15px] text-ink">{fmtNumber(Number(value), 3)}</p>
                    </div>
                  ))}
              </div>
              {evaluation?.notes && evaluation.notes.length > 0 && (
                <div className="mt-4 space-y-1">
                  {evaluation.notes.map((note) => (
                    <p key={note} className="flex items-start gap-1.5 text-[10.5px] text-muted">
                      <TriangleAlert size={11} className="mt-0.5 shrink-0 text-warning" /> {note}
                    </p>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-card border border-line bg-surface p-5">
              <h3 className="font-display text-[15px] text-ink">Feature importance</h3>
              <p className="mt-0.5 text-[10.5px] text-muted">Top inputs for the saved model.</p>
              <div className="mt-4 space-y-2.5">
                {importance.slice(0, 8).map((entry) => (
                  <div key={entry.feature}>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate font-mono text-[10px] text-ink/80" title={entry.feature}>
                        {entry.feature}
                      </p>
                      <p className="font-mono text-[9.5px] text-muted">{fmtNumber(entry.importance, 3)}</p>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(100, entry.importance * 100)}%` }}
                        transition={{ duration: 0.6 }}
                        className="h-full rounded-full bg-accent"
                      />
                    </div>
                  </div>
                ))}
                {!importance.length && <p className="text-[11.5px] text-muted">No importance values returned.</p>}
              </div>
            </div>
          </div>

          {task === "classification" ? (
            <div className="grid gap-4 lg:grid-cols-[1fr_1.3fr]">
              <div className="rounded-card border border-line bg-surface p-5">
                <h3 className="font-display text-[15px] text-ink">Confusion matrix</h3>
                <p className="mt-0.5 text-[10.5px] text-muted">Held-out test rows, best model.</p>
                {confusion ? (
                  <div className="mt-4 overflow-x-auto">
                    <div
                      className="min-w-[300px]"
                      style={{
                        display: "grid",
                        gridTemplateColumns: `minmax(72px,1fr) repeat(${confusion.labels.length}, minmax(56px,1fr))`,
                      }}
                    >
                      <div />
                      {confusion.labels.map((label) => (
                        <div key={label} className="truncate px-1 pb-1.5 text-center font-mono text-[9px] text-muted">
                          {label}
                        </div>
                      ))}
                      {confusion.labels.map((rowLabel, rowIndex) => (
                        <div key={rowLabel} className="contents">
                          <div className="flex items-center justify-end pr-2 font-mono text-[9.5px] text-muted">
                            {rowLabel}
                          </div>
                          {confusion.labels.map((columnLabel, columnIndex) => {
                            const value = confusion.matrix[rowIndex]?.[columnIndex] ?? 0;
                            const max = Math.max(1, ...confusion.matrix.flat());
                            const intensity = value / max;
                            return (
                              <div
                                key={columnLabel}
                                title={`Actual ${rowLabel}, predicted ${columnLabel}: ${value}`}
                                className="m-[2px] flex h-11 items-center justify-center rounded-md font-mono text-[11px]"
                                style={{
                                  backgroundColor: `rgba(170,89,47,${0.08 + intensity * 0.78})`,
                                  color: intensity > 0.5 ? "#fff8f2" : palette.ink,
                                }}
                              >
                                {value}
                              </div>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="mt-4 text-[11.5px] text-muted">No confusion matrix was returned.</p>
                )}
              </div>

              <div className="rounded-card border border-line bg-surface p-5">
                <h3 className="font-display text-[15px] text-ink">Actual vs predicted</h3>
                <p className="mt-0.5 text-[10.5px] text-muted">Up to 60 held-out rows; labels are class names.</p>
                <div className="mt-3 h-[260px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 8, right: 16, bottom: 4, left: -18 }}>
                      <CartesianGrid stroke={palette.grid} strokeDasharray="3 4" />
                      <XAxis
                        dataKey="index"
                        type="number"
                        tick={{ fontSize: 9, fill: palette.muted }}
                        axisLine={{ stroke: palette.grid }}
                        tickLine={false}
                      />
                      <YAxis
                        dataKey="actual_value"
                        type="number"
                        domain={[-0.4, Math.max(1, confusion ? confusion.labels.length - 1 : 1) + 0.4]}
                        tick={{ fontSize: 9, fill: palette.muted }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(value) => confusion?.labels[value] ?? String(value)}
                      />
                      <Tooltip
                        content={(props: any) => {
                          const point = props?.payload?.[0]?.payload;
                          if (!props?.active || !point) return null;
                          return (
                            <div className="rounded-lg border border-line bg-surface px-2.5 py-2 text-[10.5px] shadow-lift">
                              <p className="text-muted">Row {point.index}</p>
                              <p className="text-ink">Actual {point.actual}</p>
                              <p className="text-ink">Predicted {point.predicted}</p>
                            </div>
                          );
                        }}
                      />
                      <Scatter data={points} dataKey="actual_value" name="Actual" fill={palette.accent} />
                      <Scatter data={points} dataKey="predicted_value" name="Predicted" fill={palette.stone} shape="triangle" />
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-card border border-line bg-surface p-5">
              <h3 className="font-display text-[15px] text-ink">Actual vs predicted</h3>
              <p className="mt-0.5 text-[10.5px] text-muted">
                Regression uses R², MAE and RMSE; a confusion matrix is not applicable.
              </p>
              <div className="mt-3 h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 8, right: 20, bottom: 10, left: -8 }}>
                    <CartesianGrid stroke={palette.grid} strokeDasharray="3 4" />
                    <XAxis
                      dataKey="actual"
                      type="number"
                      tick={{ fontSize: 9, fill: palette.muted }}
                      axisLine={{ stroke: palette.grid }}
                      tickLine={false}
                      name="Actual"
                    />
                    <YAxis
                      dataKey="predicted"
                      type="number"
                      tick={{ fontSize: 9, fill: palette.muted }}
                      axisLine={false}
                      tickLine={false}
                      name="Predicted"
                    />
                    <Tooltip
                      content={(props: any) => {
                        const point = props?.payload?.[0]?.payload;
                        if (!props?.active || !point) return null;
                        return (
                          <div className="rounded-lg border border-line bg-surface px-2.5 py-2 text-[10.5px] shadow-lift">
                            <p className="text-ink">Actual {fmtNumber(point.actual, 3)}</p>
                            <p className="text-ink">Predicted {fmtNumber(point.predicted, 3)}</p>
                          </div>
                        );
                      }}
                    />
                    <ReferenceLine
                      segment={[
                        { x: Math.min(...points.map((point) => Number(point.actual))), y: Math.min(...points.map((point) => Number(point.actual))) },
                        { x: Math.max(...points.map((point) => Number(point.actual))), y: Math.max(...points.map((point) => Number(point.actual))) },
                      ]}
                      stroke={palette.stone}
                      strokeDasharray="4 4"
                    />
                    <Scatter data={points} dataKey="predicted" fill={palette.accent} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}

      {!trained && !loadingModel && (
        <div className="rounded-card border border-dashed border-line bg-surface/60 p-8 text-center">
          <p className="font-display text-lg text-ink">No model saved for this session</p>
          <p className="mx-auto mt-1.5 max-w-md text-[12px] leading-relaxed text-muted">
            Pick a target and run the comparison. The best model powers Predict and Reports.
          </p>
        </div>
      )}
    </div>
  );
}
