import { AlertTriangle, ArrowRight, BrainCircuit, LineChart } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartCard } from "../../components/ChartCard";
import { Badge, Button, ErrorPanel, Skeleton, StepHeader } from "../../components/ui";
import { api } from "../../lib/api";
import { fmtNumber } from "../../lib/format";
import { useChartPalette, useTheme } from "../../lib/theme";
import type { ChartsResponse } from "../../lib/types";

type TooltipPayload = { name?: string; value?: number | string; color?: string; payload?: Record<string, unknown> };

function ChartTooltip({
  active,
  payload,
  label,
  unit = "",
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string | number;
  unit?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[11px] shadow-lift">
      {label !== undefined && <p className="mb-1 font-medium text-ink">{label}</p>}
      {payload.map((entry, index) => (
        <p key={index} className="flex items-center gap-2 text-muted">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: entry.color }} />
          {entry.name}: <span className="font-mono text-ink">{fmtNumber(Number(entry.value), 3)}{unit}</span>
        </p>
      ))}
    </div>
  );
}

function Heatmap({ data }: { data: { columns: string[]; matrix: number[][] } }) {
  const palette = useChartPalette();
  const { isDark } = useTheme();
  const [hover, setHover] = useState<{ row: string; column: string; value: number } | null>(null);

  const cellColor = (value: number) => {
    const alpha = Math.min(0.92, 0.08 + Math.abs(value) * 0.82);
    if (value >= 0) {
      return isDark ? `rgba(209,123,78,${alpha})` : `rgba(170,89,47,${alpha})`;
    }
    return isDark ? `rgba(143,131,118,${alpha})` : `rgba(70,54,53,${alpha})`;
  };

  return (
    <div>
      <div className="overflow-x-auto">
        <div
          className="min-w-[520px]"
          style={{ display: "grid", gridTemplateColumns: `minmax(112px,1.4fr) repeat(${data.columns.length}, minmax(42px,1fr))` }}
        >
          <div />
          {data.columns.map((column) => (
            <div
              key={column}
              className="truncate px-1 pb-2 text-center font-mono text-[8.5px] uppercase tracking-[0.02em] text-muted"
              title={column}
            >
              {column.length > 12 ? `${column.slice(0, 11)}…` : column}
            </div>
          ))}
          {data.columns.map((row, rowIndex) => (
            <div key={row} className="contents">
              <div
                className="truncate pr-2 py-[5px] text-right font-mono text-[9px] text-muted"
                title={row}
              >
                {row.length > 16 ? `${row.slice(0, 15)}…` : row}
              </div>
              {data.columns.map((column, columnIndex) => {
                const value = data.matrix[rowIndex]?.[columnIndex] ?? 0;
                const selected = hover?.row === row && hover?.column === column;
                return (
                  <button
                    key={`${row}-${column}`}
                    type="button"
                    onMouseEnter={() => setHover({ row, column, value })}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover({ row, column, value })}
                    onBlur={() => setHover(null)}
                    aria-label={`Correlation ${row} and ${column}: ${value}`}
                    className={`m-[1px] flex h-9 items-center justify-center rounded-[3px] font-mono text-[9.5px] transition ${
                      Math.abs(value) > 0.55 ? "text-white" : "text-ink/85"
                    } ${selected ? "ring-2 ring-ink/40" : ""}`}
                    style={{ backgroundColor: cellColor(value), color: Math.abs(value) > 0.55 ? "#fff8f2" : palette.ink }}
                  >
                    {value.toFixed(2)}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-2.5 text-[10px] text-muted">
        <span className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: cellColor(-0.9) }} /> negative
          <span className="ml-2 h-2.5 w-2.5 rounded-sm" style={{ background: cellColor(0) }} /> none
          <span className="ml-2 h-2.5 w-2.5 rounded-sm" style={{ background: cellColor(0.9) }} /> positive
        </span>
        <span className="font-mono">
          {hover ? `${hover.row} × ${hover.column} = ${hover.value.toFixed(3)}` : "Hover a cell"}
        </span>
      </div>
    </div>
  );
}

function ConfusionMatrix({
  data,
}: {
  data: { labels: string[]; matrix: number[][] };
}) {
  const palette = useChartPalette();
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...data.matrix.flat());
  return (
    <div>
      <div className="overflow-x-auto">
        <div
          className="min-w-[360px]"
          style={{ display: "grid", gridTemplateColumns: `minmax(86px,1.1fr) repeat(${data.labels.length}, minmax(58px,1fr))` }}
        >
          <div className="flex items-end px-1 pb-2 font-mono text-[8.5px] uppercase tracking-[0.1em] text-muted">
            actual ↓ / predicted →
          </div>
          {data.labels.map((label) => (
            <div key={label} className="truncate px-1 pb-2 text-center font-mono text-[9px] text-muted" title={label}>
              {label}
            </div>
          ))}
          {data.labels.map((rowLabel, rowIndex) => (
            <div key={rowLabel} className="contents">
              <div className="flex items-center justify-end pr-2 font-mono text-[9.5px] text-muted" title={rowLabel}>
                {rowLabel}
              </div>
              {data.labels.map((columnLabel, columnIndex) => {
                const value = data.matrix[rowIndex]?.[columnIndex] ?? 0;
                const intensity = value / max;
                const isDiagonal = rowIndex === columnIndex;
                return (
                  <div
                    key={columnLabel}
                    onMouseEnter={() => setHover(`${rowLabel} → ${columnLabel}: ${value}`)}
                    onMouseLeave={() => setHover(null)}
                    title={`Actual ${rowLabel}, predicted ${columnLabel}: ${value}`}
                    className="m-[2px] flex h-12 items-center justify-center rounded-md font-mono text-[11px] transition"
                    style={{
                      backgroundColor: `rgba(170, 89, 47, ${0.08 + intensity * 0.78})`,
                      color: intensity > 0.5 ? "#fff8f2" : palette.ink,
                      outline: isDiagonal ? `1px solid ${palette.accent}` : "none",
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
      <p className="mt-3 border-t border-line pt-2 font-mono text-[9.5px] text-muted">
        {hover ?? "Diagonal cells are correct predictions."}
      </p>
    </div>
  );
}

export function ChartsTab({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate();
  const palette = useChartPalette();
  const [data, setData] = useState<ChartsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setError(null);
    api
      .charts(sessionId)
      .then(setData)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Could not build charts."));
  };

  useEffect(load, [sessionId]);

  if (error) return <ErrorPanel message={error} onRetry={load} />;

  if (!data) {
    return (
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-72 rounded-card" />
        <Skeleton className="h-72 rounded-card" />
        <Skeleton className="h-64 rounded-card" />
        <Skeleton className="h-64 rounded-card" />
      </div>
    );
  }

  const model = data.model;
  const isClassification = model?.task === "classification";
  const trainAction = (
    <Button size="sm" variant="secondary" onClick={() => navigate(`/workspace/${sessionId}/train`)} icon={<ArrowRight size={12} />}>
      Train
    </Button>
  );

  const actualPredicted = data.actualVsPredicted;
  const regressionMin = Math.min(
    ...actualPredicted.flatMap((point) => [Number(point.actual), Number(point.predicted)]),
  );
  const regressionMax = Math.max(
    ...actualPredicted.flatMap((point) => [Number(point.actual), Number(point.predicted)]),
  );

  return (
    <div className="space-y-6">
      <StepHeader
        step="Step 05 · Visualise"
        title="Relationships, distributions, drivers."
        description="Built from the fused dataset; model charts use the saved model. Download any card as PNG."
        actions={
          model ? (
            <div className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[11px] text-muted">
              Model: <span className="text-ink">{model.name}</span> · target{" "}
              <span className="text-ink">{model.target}</span>
            </div>
          ) : (
            <Badge tone="warning">No model yet</Badge>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Correlation heatmap"
          subtitle={
            data.correlation
              ? "Pearson correlation across numeric columns (up to 10)."
              : "Needs at least two numeric columns."
          }
          filename="correlation-heatmap"
          className="lg:col-span-2"
        >
          {data.correlation ? (
            <Heatmap data={data.correlation} />
          ) : (
            <p className="rounded-xl border border-dashed border-line p-8 text-center text-[12px] text-muted">
              The fused dataset does not have two numeric columns, so no correlation matrix can be computed.
            </p>
          )}
        </ChartCard>

        <ChartCard
          title="Class distribution"
          subtitle={data.classDistribution ? `Target: ${data.classDistribution.column}` : "No target selected."}
          filename="class-distribution"
        >
          {data.classDistribution ? (
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.classDistribution.data} margin={{ top: 8, right: 10, left: -18, bottom: 4 }}>
                  <CartesianGrid stroke={palette.grid} strokeDasharray="3 4" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: palette.muted }}
                    axisLine={{ stroke: palette.grid }}
                    tickLine={false}
                    interval={0}
                    angle={data.classDistribution.data.length > 6 ? -24 : 0}
                    textAnchor={data.classDistribution.data.length > 6 ? "end" : "middle"}
                    height={data.classDistribution.data.length > 6 ? 52 : 30}
                  />
                  <YAxis tick={{ fontSize: 10, fill: palette.muted }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(144,135,121,0.08)" }} />
                  <Bar dataKey="value" name="Rows" radius={[4, 4, 0, 0]}>
                    {data.classDistribution.data.map((entry, index) => (
                      <Cell key={entry.label} fill={palette.colors[index % palette.colors.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-[240px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-center">
              <AlertTriangle size={18} className="text-muted" />
              <p className="max-w-xs text-[12px] text-muted">
                Choose a target in Train Models to see its distribution.
              </p>
              {trainAction}
            </div>
          )}
        </ChartCard>

        <ChartCard
          title="Feature importance"
          subtitle="Drivers of the saved best model (normalised)."
          filename="feature-importance"
        >
          {data.featureImportance.length ? (
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.featureImportance.map((entry) => ({
                    name: entry.feature.length > 30 ? `${entry.feature.slice(0, 29)}…` : entry.feature,
                    importance: entry.importance,
                  }))}
                  layout="vertical"
                  margin={{ top: 4, right: 20, left: 8, bottom: 4 }}
                >
                  <CartesianGrid stroke={palette.grid} strokeDasharray="3 4" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 9, fill: palette.muted }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={150}
                    tick={{ fontSize: 9, fill: palette.muted }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(144,135,121,0.08)" }} />
                  <Bar dataKey="importance" name="Importance" fill={palette.accent} radius={[0, 3, 3, 0]} barSize={13} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-[240px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-center">
              <BrainCircuit size={18} className="text-muted" />
              <p className="max-w-xs text-[12px] text-muted">Train a model to see which features drive it.</p>
              {trainAction}
            </div>
          )}
        </ChartCard>

        <ChartCard
          title="Actual vs predicted"
          subtitle={
            model
              ? isClassification
                ? "Held-out test rows; points show actual and predicted class index."
                : "Held-out test rows plotted against the ideal diagonal."
              : "Available after training."
          }
          filename="actual-vs-predicted"
          className="lg:col-span-2"
        >
          {actualPredicted.length ? (
            <div className="h-[320px]">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 10, right: 20, bottom: 12, left: -12 }}>
                  <CartesianGrid stroke={palette.grid} strokeDasharray="3 4" />
                  <XAxis
                    dataKey={isClassification ? "index" : "actual"}
                    name={isClassification ? "Test row" : "Actual"}
                    type="number"
                    domain={isClassification ? ["dataMin - 1", "dataMax + 1"] : [regressionMin, regressionMax]}
                    tick={{ fontSize: 10, fill: palette.muted }}
                    axisLine={{ stroke: palette.grid }}
                    tickLine={false}
                    label={
                      isClassification
                        ? undefined
                        : { value: "Actual", position: "insideBottom", offset: -6, fontSize: 10, fill: palette.muted }
                    }
                  />
                  <YAxis
                    dataKey={isClassification ? "actual_value" : "predicted"}
                    name={isClassification ? "Class" : "Predicted"}
                    type="number"
                    domain={isClassification ? [-0.4, Math.max(1, (data.confusionMatrix?.labels.length ?? 2) - 1) + 0.4] : [regressionMin, regressionMax]}
                    tick={{ fontSize: 10, fill: palette.muted }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value) => {
                      if (!isClassification) return String(value);
                      const labels = data.confusionMatrix?.labels ?? [];
                      return labels[value] ?? String(value);
                    }}
                  />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    content={(props: any) => {
                      const active = props?.active;
                      const payload = props?.payload as any[] | undefined;
                      if (!active || !payload?.length) return null;
                      const point = payload[0].payload as Record<string, unknown>;
                      return (
                        <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[11px] shadow-lift">
                          <p className="text-muted">Row {String(point.index)}</p>
                          <p className="mt-1 text-ink">Actual: {String(point.actual)}</p>
                          <p className="text-ink">Predicted: {String(point.predicted)}</p>
                        </div>
                      );
                    }}
                  />
                  {!isClassification && (
                    <ReferenceLine
                      segment={[
                        { x: regressionMin, y: regressionMin },
                        { x: regressionMax, y: regressionMax },
                      ]}
                      stroke={palette.stone}
                      strokeDasharray="4 4"
                    />
                  )}
                  <Scatter
                    data={actualPredicted}
                    dataKey={isClassification ? "actual_value" : "predicted"}
                    name="Actual"
                    fill={palette.accent}
                    shape="circle"
                  />
                  {isClassification && (
                    <Scatter
                      data={actualPredicted}
                      dataKey="predicted_value"
                      name="Predicted"
                      fill={palette.stone}
                      shape="triangle"
                    />
                  )}
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-[250px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line text-center">
              <LineChart size={18} className="text-muted" />
              <p className="max-w-sm text-[12px] text-muted">Held-out predictions appear after training.</p>
              {trainAction}
            </div>
          )}
        </ChartCard>

        <ChartCard
          title="Confusion matrix"
          subtitle={
            model
              ? isClassification
                ? "Counts on the held-out test split."
                : "Not applicable to a continuous target."
              : "Classification target required."
          }
          filename="confusion-matrix"
          className={isClassification ? "" : "lg:col-span-2"}
        >
          {data.confusionMatrix ? (
            <ConfusionMatrix data={data.confusionMatrix} />
          ) : (
            <div className="flex h-[230px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line px-4 text-center">
              <AlertTriangle size={18} className="text-muted" />
              <p className="max-w-sm text-[12px] text-muted">
                {model && model.task === "regression"
                  ? `'${model.target}' is continuous — R², MAE and RMSE are reported instead.`
                  : "A confusion matrix needs a trained classification model."}
              </p>
              {!model && trainAction}
            </div>
          )}
        </ChartCard>

        {data.histograms.slice(0, 4).map((histogram) => (
          <ChartCard
            key={histogram.column}
            title={`Histogram · ${histogram.column}`}
            subtitle="Distribution across the fused rows."
            filename={`histogram-${histogram.column}`}
          >
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={histogram.bins} margin={{ top: 6, right: 10, left: -20, bottom: 4 }}>
                  <CartesianGrid stroke={palette.grid} strokeDasharray="3 4" vertical={false} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 8.5, fill: palette.muted }}
                    tickLine={false}
                    axisLine={{ stroke: palette.grid }}
                    interval="preserveStartEnd"
                  />
                  <YAxis tick={{ fontSize: 9, fill: palette.muted }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(144,135,121,0.08)" }} />
                  <Bar dataKey="value" name="Rows" fill={palette.accent} radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>
        ))}

        <ChartCard
          title="Box plots"
          subtitle="Five-number summary and 1.5×IQR fences for numeric columns."
          filename="box-plots"
          className="lg:col-span-2"
        >
          {data.boxplots.length ? (
            <div className="space-y-4">
              {data.boxplots.map((box) => {
                const span = box.max - box.min || 1;
                const left = ((box.q1 - box.min) / span) * 100;
                const width = ((box.max - box.min) / span) * 100;
                return (
                  <div key={box.column}>
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="truncate font-mono text-[10.5px] text-ink/85">{box.column}</p>
                      <p className="shrink-0 font-mono text-[9.5px] text-muted">
                        {box.outlier_count} beyond fences · median {fmtNumber(box.median, 2)}
                      </p>
                    </div>
                    <div
                      className="relative mt-2 h-7 rounded-md border border-line bg-canvas"
                      title={`min ${box.min} · Q1 ${box.q1} · median ${box.median} · Q3 ${box.q3} · max ${box.max}`}
                    >
                      <div className="absolute inset-y-0 left-0 w-full">
                        <div className="absolute left-0 top-1/2 h-[1px] w-full -translate-y-1/2 bg-line" />
                        <div className="absolute top-1/2 h-3 w-[1px] -translate-y-1/2 bg-muted" style={{ left: "0%" }} />
                        <div
                          className="absolute top-1/2 h-3 w-[1px] -translate-y-1/2 bg-muted"
                          style={{ left: `${width}%` }}
                        />
                        <div
                          className="absolute top-1/2 h-4 -translate-y-1/2 rounded-sm border border-accent/50 bg-accent-soft"
                          style={{ left: `${left}%`, width: `${Math.max(1, ((box.q3 - box.q1) / span) * 100)}%` }}
                        />
                        <div
                          className="absolute top-1/2 h-6 w-[2px] -translate-y-1/2 rounded bg-accent"
                          style={{ left: `${((box.median - box.min) / span) * 100}%` }}
                        />
                      </div>
                    </div>
                    <div className="mt-0.5 flex justify-between font-mono text-[9px] text-muted">
                      <span>{fmtNumber(box.min, 2)}</span>
                      <span>{fmtNumber(box.max, 2)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-line p-8 text-center text-[12px] text-muted">
              No numeric columns are available for box plots.
            </p>
          )}
        </ChartCard>
      </div>
    </div>
  );
}
