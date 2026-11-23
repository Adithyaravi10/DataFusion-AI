export type Task = "classification" | "regression";

export interface FileInfo {
  id: string;
  name: string;
  format: string;
  size: number;
  rows: number;
  cols: number;
  columns: string[];
  preview: Record<string, unknown>[];
  warnings: string[];
  source: string;
}

export interface TargetInfo {
  column: string;
  task: Task;
  reason?: string;
  confidence?: number;
  classes?: string[];
  missing_pct?: number;
}

export interface FusionConflict {
  column: string;
  rows: number;
  rule: string;
  examples: { left: unknown; right: unknown; kept: unknown }[];
}

export interface FusionStep {
  source: string;
  left_source: string;
  left_key: string;
  right_key: string;
  rows_before: number;
  rows_after: number;
  exact_matches: number;
  fuzzy_matches: number;
  fuzzy_examples: string[];
  unmatched: number;
  match_rate: number;
  aggregated_from: number | null;
  aggregated_to: number | null;
  conflicts: FusionConflict[];
  columns_added: number;
}

export interface FusionStats {
  base_source: string;
  steps: FusionStep[];
  join_keys: { source: string; left: string; right: string }[];
  conflicts_total: number;
  fuzzy_total: number;
  duplicates_removed: number;
  final_rows: number;
  final_columns: number;
  sources_used: string[];
  remaining_missing?: number;
  target_suggestion?: TargetInfo | null;
  completed_at?: string;
  source_files?: string[];
  single_source?: boolean;
}

export interface Report {
  id: string;
  created_at: string;
  title?: string;
  session_id?: string;
  session_name?: string;
  rows: number;
  features: number;
  target: string | null;
  best_model: string | null;
  metrics?: Record<string, number> | null;
  downloads: { pdf: string; csv: string; xlsx: string };
}

export interface ModelSummary {
  task: Task;
  target: string;
  best_model: string;
  best_metrics: Record<string, number>;
  reason: string;
  trained_at: string;
  schema: PredictField[];
  metrics_table?: MetricsRow[];
  evaluation?: Evaluation;
  confusion_matrix?: ConfusionMatrix | null;
  feature_importance?: FeatureImportance[];
}

export interface Evaluation {
  task: Task;
  target: string;
  n_train: number;
  n_test: number;
  test_size: number;
  cv_folds: number;
  features: string[];
  metrics_table: MetricsRow[];
  best_model: string;
  best_key: string;
  best_metrics: Record<string, number>;
  reason: string;
  confusion_matrix: ConfusionMatrix | null;
  actual_vs_predicted: ActualPoint[];
  feature_importance: FeatureImportance[];
  class_labels: string[];
  notes: string[];
  trained_at: string;
}

export interface MetricsRow {
  model: string;
  key: string;
  duration_s: number;
  accuracy?: number;
  precision?: number;
  recall?: number;
  f1?: number;
  r2?: number;
  mae?: number;
  rmse?: number;
  cv_accuracy_mean?: number;
  cv_accuracy_std?: number;
  cv_f1_mean?: number;
  cv_f1_std?: number;
  cv_r2_mean?: number;
  cv_r2_std?: number;
  cv_rmse_mean?: number;
  cv_rmse_std?: number;
}

export interface ConfusionMatrix {
  labels: string[];
  matrix: number[][];
}

export interface FeatureImportance {
  feature: string;
  importance: number;
}

export interface ActualPoint {
  index: number;
  actual: string | number;
  predicted: string | number;
  actual_value?: number;
  predicted_value?: number;
}

export interface Session {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  status: "uploaded" | "fusing" | "ready" | "error" | string;
  file_count: number;
  job_id: string | null;
  files: FileInfo[];
  fusion: FusionStats | null;
  target: TargetInfo | null;
  model: ModelSummary | null;
  has_model: boolean;
  reports: Report[];
}

export interface UploadResponse {
  session: Session;
  files: FileInfo[];
  warning: string | null;
}

export interface Stage {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "error";
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | null;
  logs: { at: string; message: string }[];
}

export interface JobStatus {
  id: string;
  session_id: string;
  created_at: string;
  state: "running" | "awaiting_confirmation" | "done" | "error";
  progress: number;
  error: string | null;
  needs: NeedsConfirmation | null;
  summary: {
    rows: number;
    columns: number;
    target: TargetInfo | null;
    conflicts: number;
    fuzzy_matches: number;
    sources: number;
  } | null;
  stages: Stage[];
  live?: boolean;
}

export interface NeedsConfirmation {
  type: string;
  message: string;
  sources?: Record<string, { columns: string[]; merged_columns: string[] }>;
  plan?: { source: string; left_key: string; right_key: string; coverage: number }[];
  candidates?: KeyCandidate[];
  columns?: Record<string, string[]>;
}

export interface KeyCandidate {
  left_source: string;
  left_column: string;
  right_source: string;
  right_column: string;
  overlap: number;
  left_coverage: number;
  right_coverage: number;
  score: number;
  manual?: boolean;
}

export interface CleanReport {
  source: string;
  before: Snapshot;
  after: Snapshot;
  renamed_columns: { from: string; to: string }[] | unknown[];
  dropped_all_null: string[];
  whitespace_fixed: number;
  numeric_converted: { column: string; values: number; examples: string[] }[];
  dates_parsed: { column: string; parsed: number; failed: number }[];
  casing_fixed: { column: string; values: number; before: string[] }[];
  missing: { column: string; before: number; after: number; method: string }[];
  outliers: { column: string; count: number; lower: number; upper: number; examples: unknown[] }[];
  constant_columns: string[];
  duplicates_removed: number;
  rows_removed: number;
  missing_filled: number;
  notes: string[];
}

export interface Snapshot {
  rows: number;
  columns: number;
  missing_cells: number;
  duplicate_rows: number;
  missing_pct: number;
}

export interface CleanResponse {
  session_id: string;
  reports: CleanReport[];
  downloads: Record<string, string>;
  totals: {
    rows_before: number;
    rows_after: number;
    duplicates_removed: number;
    missing_filled: number;
    outlier_columns: number;
    numeric_fixed: number;
    dates_fixed: number;
  };
}

export interface TableColumn {
  name: string;
  type: string;
}

export interface PaginatedTable {
  columns: TableColumn[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  pages: number;
  page_size: number;
}

export interface CombineResponse {
  stats: FusionStats;
  table: PaginatedTable;
  target: TargetInfo | null;
  download: string;
}

export interface OverviewRow {
  feature: string;
  type: string;
  missing_pct: number;
  unique: number;
  min?: number | null;
  max?: number | null;
  mean?: number | null;
  top?: string | null;
  top_count?: number;
}

export interface Insight {
  kind: "info" | "warning" | "pattern" | string;
  title: string;
  text: string;
}

export interface AnalyseResponse {
  stats: {
    total_records: number;
    features: number;
    missing_pct: number;
    duplicates: number;
    numeric_columns: number;
    categorical_columns: number;
  };
  overview: OverviewRow[];
  summary: {
    column: string;
    min: number;
    q1: number;
    median: number;
    q3: number;
    max: number;
    mean: number;
  }[];
  insights: Insight[];
  correlation: { columns: string[]; matrix: number[][] } | null;
  target: TargetInfo | null;
}

export interface ChartBin {
  label: string;
  value: number;
}

export interface ChartsResponse {
  correlation: { columns: string[]; matrix: number[][] } | null;
  classDistribution: { column: string; type: "categorical" | "numeric"; data: ChartBin[] } | null;
  histograms: { column: string; bins: ChartBin[] }[];
  boxplots: {
    column: string;
    min: number;
    q1: number;
    median: number;
    q3: number;
    max: number;
    lower: number;
    upper: number;
    outlier_count: number;
  }[];
  featureImportance: FeatureImportance[];
  confusionMatrix: ConfusionMatrix | null;
  actualVsPredicted: ActualPoint[];
  model: {
    name: string;
    task: Task;
    target: string;
    metrics: Record<string, number>;
  } | null;
}

export interface PredictField {
  name: string;
  kind: "numeric" | "categorical";
  min?: number;
  max?: number;
  median?: number;
  step?: number;
  options?: string[];
}

export interface PredictResponse {
  task: Task;
  target: string;
  features: string[];
  predictions: {
    row: number;
    prediction: string | number;
    confidence?: number;
    probabilities?: Record<string, number>;
  }[];
}

export interface BatchResponse extends PredictResponse {
  total: number;
  preview: Record<string, unknown>[];
  download: string;
}

export interface AIInsightsResult {
  response: string;
  provider: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  fallback_used: boolean;
  fallback_reason?: string | null;
  question?: string | null;
  generated_at: string;
}

export interface AIProviderInfo {
  configured: boolean;
  enabled: boolean;
  model: string;
  position: number | null;
}

export interface AIProviderStatus {
  order: string[];
  providers: Record<string, AIProviderInfo>;
}

export interface AIUsageProviderStats {
  requests: number;
  successes: number;
  failures: number;
  input_tokens: number;
  output_tokens: number;
}

export interface AIUsageSummary {
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  total_input_tokens: number;
  total_output_tokens: number;
  providers: Record<string, AIUsageProviderStats>;
}

export interface AIUsageRecord {
  timestamp: string;
  provider: string;
  model: string;
  status: "success" | "failed" | string;
  input_tokens: number;
  output_tokens: number;
  fallback_used: boolean;
  fallback_reason?: string | null;
  error?: string | null;
}

export interface HistoryItem {
  id: string;
  name: string;
  created_at: string;
  status: string;
  file_count: number;
  rows: number | null;
  features: number | null;
  target: string | null;
  best_model: string | null;
  reports: number;
}
