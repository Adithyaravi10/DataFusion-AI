import { motion } from "framer-motion";
import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  BrainCircuit,
  ChevronDown,
  Database,
  FileDown,
  GitMerge,
  History,
  LineChart,
  ScanSearch,
  Sparkles,
  Upload,
} from "lucide-react";
import { Suspense, lazy, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { SceneBoundary } from "../components/SceneBoundary";
import { Badge, Button, SectionLabel } from "../components/ui";
import { useTheme } from "../lib/theme";

const FusionScene3D = lazy(() =>
  import("../components/FusionScene3D").then((module) => ({ default: module.FusionScene3D })),
);

interface Feature {
  icon: ReactNode;
  title: string;
  summary: string;
  detail: string;
}

const features: Feature[] = [
  {
    icon: <Database size={19} />,
    title: "Multi-Source Ingestion",
    summary: "CSV, XLSX, JSON and TSV with validation.",
    detail:
      "Every upload is validated for format, size and emptiness, parsed with encoding and delimiter fallbacks, then previewed as rows × columns.",
  },
  {
    icon: <Sparkles size={19} />,
    title: "Smart Data Cleaning",
    summary: "Missing values, duplicates and formats.",
    detail:
      "Whitespace, currency, dates, casing, imputation, IQR capping and deduplication — each action logged with counts.",
  },
  {
    icon: <GitMerge size={19} />,
    title: "Key-Based + Fuzzy Fusion",
    summary: "Align records even when keys are missing.",
    detail:
      "Exact joins on detected keys, rapidfuzz linking where keys are missing, and logged non-null → recent → majority conflict resolution.",
  },
  {
    icon: <ScanSearch size={19} />,
    title: "Automated EDA",
    summary: "Statistics, correlations and rule-based insight.",
    detail:
      "Column profiles, missing rates, distributions, skew and correlation — with insights derived from those statistics.",
  },
  {
    icon: <LineChart size={19} />,
    title: "Interactive Visualizations",
    summary: "Correlation, distribution, importance and more.",
    detail:
      "Heatmap, class distribution, feature importance, histograms and box plots with real values — each exportable as PNG.",
  },
  {
    icon: <BrainCircuit size={19} />,
    title: "ML Prediction",
    summary: "Random Forest, Decision Tree, LR and SVM.",
    detail:
      "Four estimators trained with random_state=42, scored on a hold-out split and k-fold CV; the best is saved for prediction.",
  },
  {
    icon: <FileDown size={19} />,
    title: "Downloadable Reports",
    summary: "PDF, fused CSV and Excel summary.",
    detail:
      "PDF narrative, fused CSV and multi-sheet Excel workbook assembled from the stored run.",
  },
  {
    icon: <History size={19} />,
    title: "Session History",
    summary: "Sessions survive refresh.",
    detail:
      "Sessions are stored on disk with uploads, model and reports; reopen or delete them from History.",
  },
];

const steps = [
  {
    key: "clean",
    title: "Clean Data",
    summary: "Make every source internally consistent and traceable.",
    techniques: "Whitespace trimming, numeric/currency parsing, mixed-date parsing, category casing, median/mode imputation, IQR capping, exact deduplication.",
    input: "Raw uploaded files (validated CSV/TSV/XLSX/XLS/JSON).",
    output: "One cleaned frame per source plus a per-column wrangling report.",
  },
  {
    key: "combine",
    title: "Combine Data",
    summary: "Align sources on keys, then fuzzy-link what keys miss.",
    techniques: "Key detection by name + value overlap, canonical key tokens, many-to-one aggregation, rapidfuzz token-sort matching, non-null → recent → majority reconciliation.",
    input: "Cleaned source frames and the detected join candidates.",
    output: "A single fused dataset with match statistics and conflict log.",
  },
  {
    key: "analyse",
    title: "Analyse Data",
    summary: "Profile the fused table and surface honest findings.",
    techniques: "Type and uniqueness profiling, missing-rate analysis, five-number summaries, Pearson correlations, skewness, class balance.",
    input: "The fused dataset and the selected/suggested target.",
    output: "Stat cards, dataset overview, statistical summary and rule-based insights.",
  },
  {
    key: "charts",
    title: "View Charts",
    summary: "See distributions, relationships and model drivers.",
    techniques: "Correlation heatmap, target distribution, histograms, box plots, feature importance, actual-vs-predicted, confusion matrix.",
    input: "Fused data plus the best model's evaluation payload.",
    output: "Interactive charts, each downloadable as PNG.",
  },
  {
    key: "train",
    title: "Train Models",
    summary: "Compare four models fairly on the same split.",
    techniques: "Stratified train/test split, 5-fold CV, weighted precision/recall/F1 for classification; R², MAE, RMSE for regression; fixed seed 42.",
    input: "Fused features, chosen target, test size and CV folds.",
    output: "A metrics table, best-model reasoning and a saved model artifact.",
  },
  {
    key: "predict",
    title: "Predict",
    summary: "Score one record or an entire batch.",
    techniques: "Auto-generated feature form, pipeline imputation/encoding, class probabilities where the estimator supports them.",
    input: "Manual feature values or a CSV with the required feature columns.",
    output: "Predictions with confidence/probabilities and a downloadable batch CSV.",
  },
  {
    key: "reports",
    title: "Reports",
    summary: "Package the whole run into shareable artefacts.",
    techniques: "ReportLab PDF with matplotlib chart images, OpenPyXL multi-sheet workbook, fused CSV export.",
    input: "Sources, cleaning log, fusion stats, insights, model results.",
    output: "PDF report, fused CSV and Excel summary, listed in Fusion Reports.",
  },
];

function FeatureCard({ feature, index }: { feature: Feature; index: number }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.5, delay: (index % 4) * 0.05, ease: [0.16, 1, 0.3, 1] }}
      className="flip-card group h-[228px]"
    >
      <button
        type="button"
        aria-expanded={flipped}
        aria-label={`${feature.title}. ${feature.summary} Activate for details.`}
        onClick={() => setFlipped((value) => !value)}
        onMouseLeave={() => setFlipped(false)}
        className={`flip-inner relative block h-full w-full rounded-card border border-line bg-surface text-left shadow-soft transition-colors duration-300 hover:border-accent/50 hover:shadow-lift ${
          flipped ? "[transform:rotateY(180deg)]" : "group-hover:[transform:rotateY(180deg)]"
        }`}
      >
        <div className="flip-face absolute inset-0 flex flex-col justify-between p-5">
          <div className="flex items-start justify-between">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-canvas text-accent">
              {feature.icon}
            </span>
            <ArrowUpRight size={15} className="text-muted transition group-hover:text-accent" />
          </div>
          <div>
            <h3 className="font-display text-[16.5px] leading-tight text-ink">{feature.title}</h3>
            <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{feature.summary}</p>
            <span className="mt-3 inline-flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.16em] text-accent opacity-0 transition group-hover:opacity-100">
              Hover / tap for detail
            </span>
          </div>
        </div>
        <div className="flip-face flip-back absolute inset-0 flex flex-col rounded-card bg-[#100e0c] p-5 text-[#f0ebe3]">
          <div className="flex items-center gap-2 text-[#d17b4e]">
            {feature.icon}
            <span className="font-mono text-[9px] uppercase tracking-[0.18em]">Inside the engine</span>
          </div>
          <p className="mt-3 text-[12px] leading-[1.65] text-[#d9d0c5]">{feature.detail}</p>
          <span className="mt-auto pt-3 text-[10px] uppercase tracking-[0.16em] text-[#8f8376]">
            {feature.title}
          </span>
        </div>
      </button>
    </motion.div>
  );
}

function SceneHud({ className = "" }: { className?: string }) {
  return (
    <div
      className={`pointer-events-none font-mono text-[9px] uppercase tracking-[0.24em] text-[#8c8175] ${className}`}
    >
      <span className="absolute left-1/2 -translate-x-1/2">Perspective · Live</span>
      <span className="absolute right-9">Powered by Fusion AT</span>
    </div>
  );
}

function Workflow() {
  const [open, setOpen] = useState(0);
  return (
    <section id="workflow" className="scroll-mt-24 px-0 pb-20">
      <div className="relative overflow-hidden rounded-[2rem] galaxy border border-white/10 px-5 py-12 sm:px-9 lg:px-12">
        <div className="relative z-10">
          <div className="flex flex-col gap-5 border-b border-white/10 pb-9 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-xl">
              <SectionLabel light>Project workflow</SectionLabel>
              <h2 className="mt-4 font-display text-[clamp(2rem,4vw,3.1rem)] leading-[1.02] text-[#f4efe7]">
                Seven stages.
                <br />
                <span className="text-[#a89b8d]">No invented numbers.</span>
              </h2>
            </div>
            <p className="max-w-sm text-[13px] leading-relaxed text-[#a89b8d]">
              Each stage runs on the files you upload. Expand a step for techniques, inputs and outputs.
            </p>
          </div>

          <div className="mt-2 divide-y divide-white/10">
            {steps.map((step, index) => {
              const isOpen = open === index;
              return (
                <div key={step.key}>
                  <button
                    type="button"
                    onClick={() => setOpen(isOpen ? -1 : index)}
                    aria-expanded={isOpen}
                    className="flex w-full items-center gap-4 py-5 text-left transition sm:gap-6"
                  >
                    <span
                      className={`font-mono text-[11px] tabular-nums transition ${
                        isOpen ? "text-[#d17b4e]" : "text-[#6d6258]"
                      }`}
                    >
                      0{index + 1}
                    </span>
                    <span className="flex-1">
                      <span
                        className={`block font-display text-[17px] transition sm:text-[19px] ${
                          isOpen ? "text-[#f4efe7]" : "text-[#cfc6ba]"
                        }`}
                      >
                        {step.title}
                      </span>
                      <span className="mt-0.5 block text-[12px] text-[#8f8376]">{step.summary}</span>
                    </span>
                    <ChevronDown
                      size={16}
                      className={`shrink-0 text-[#8f8376] transition-transform duration-300 ${
                        isOpen ? "rotate-180 text-[#d17b4e]" : ""
                      }`}
                    />
                  </button>
                  <motion.div
                    initial={false}
                    animate={{ height: isOpen ? "auto" : 0, opacity: isOpen ? 1 : 0 }}
                    transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="grid gap-5 pb-6 pl-8 pr-6 sm:grid-cols-3 sm:pl-12">
                      <div>
                        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#7f7368]">Techniques</p>
                        <p className="mt-2 text-[12px] leading-relaxed text-[#b9aea1]">{step.techniques}</p>
                      </div>
                      <div>
                        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#7f7368]">Input</p>
                        <p className="mt-2 text-[12px] leading-relaxed text-[#b9aea1]">{step.input}</p>
                      </div>
                      <div>
                        <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#7f7368]">Output</p>
                        <p className="mt-2 text-[12px] leading-relaxed text-[#b9aea1]">{step.output}</p>
                      </div>
                    </div>
                  </motion.div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const { isDark } = useTheme();

  return (
    <div>
      <section className="relative overflow-hidden border-b border-line">
        <div className={`absolute inset-0 ${isDark ? "galaxy" : ""}`} />
        {!isDark && (
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_55%_at_70%_15%,rgba(170,89,47,0.09),transparent_65%),radial-gradient(ellipse_50%_60%_at_20%_80%,rgba(144,135,121,0.14),transparent_65%)]" />
        )}
        {/* Desktop: the constellation is the hero background, centred on the right half. */}
        <div className="absolute inset-y-[72px] right-[1%] hidden w-[66%] xl:block">
          <SceneBoundary>
            <Suspense fallback={null}>
              <FusionScene3D />
            </Suspense>
          </SceneBoundary>
        </div>
        <div className="pointer-events-none absolute inset-x-0 top-9 z-10 hidden justify-center xl:flex xl:top-[46px]">
          <span className="flex items-center gap-2.5 font-mono text-[9.5px] uppercase tracking-[0.28em] text-[#a99c8c]">
            <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_10px_2px_rgba(209,123,78,0.55)]" />
            Fusion core
          </span>
        </div>
        <div className="absolute inset-x-0 bottom-11 z-10 hidden xl:block">
          <SceneHud />
        </div>

        <div className="relative z-10 mx-auto w-full max-w-[1320px] px-4 py-14 text-center sm:px-6 lg:flex lg:min-h-[724px] lg:flex-col lg:justify-center lg:px-8 lg:pb-0 lg:pt-6 lg:text-left">
          <div className="mx-auto flex min-w-0 max-w-[600px] flex-col items-center lg:mx-0 lg:max-w-[600px] lg:items-start xl:max-w-[700px]">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            <span
              className={`inline-flex items-center gap-2.5 rounded-pill border px-3.5 py-2 text-[9px] uppercase tracking-[0.14em] sm:px-4 sm:py-2.5 sm:text-[10.5px] sm:tracking-[0.22em] font-mono ${
                isDark ? "border-white/20 text-[#d8cfc3]" : "border-line bg-surface text-ink shadow-soft"
              }`}
            >
              <span className="h-2 w-2 rotate-45 border border-accent bg-accent/30" aria-hidden="true" />
              Data Mining <span className={isDark ? "text-[#7d7266]" : "text-muted"}>•</span> Wrangling{" "}
              <span className={isDark ? "text-[#7d7266]" : "text-muted"}>•</span> Fusion Engine
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
            className="mt-8 max-w-full text-balance font-display text-[clamp(2.6rem,6.1vw,5.3rem)] font-semibold leading-[1.01] tracking-[-0.045em]"
            style={{ color: isDark ? "#f4efe7" : "var(--text)" }}
          >
            Multi-Source Data Fusion{" "}
            <span className="relative inline-block text-accent">
              Engine
              <svg
                viewBox="0 0 200 12"
                aria-hidden="true"
                className="absolute -bottom-2 left-0 h-2.5 w-full text-accent/45"
                preserveAspectRatio="none"
              >
                <path d="M2 9C50 3 130 2 198 7" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
              </svg>
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.16 }}
            className="mt-7 max-w-[620px] text-balance text-[17px] leading-relaxed sm:text-[19.5px]"
            style={{ color: isDark ? "#bdb2a4" : "var(--muted)" }}
          >
            Clean, integrate, analyse, visualize and predict from multiple datasets.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.24 }}
            className="mt-9 flex flex-wrap items-center justify-center gap-3 lg:justify-start"
          >
            <Button
              size="lg"
              onClick={() => navigate("/upload")}
              icon={<ArrowUpRight size={16} />}
              className="h-[52px] min-w-[191px]"
            >
              Upload Dataset
            </Button>
            <Button
              size="lg"
              variant="secondary"
              icon={<ArrowRight size={16} />}
              onClick={() => document.getElementById("workflow")?.scrollIntoView({ behavior: "smooth" })}
              className={`h-[52px] min-w-[180px] ${
                isDark ? "border-white/25 text-[#eee7dd] hover:border-accent hover:text-accent" : ""
              }`}
            >
              How It Works
            </Button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.7 }}
            className={`mt-14 flex flex-wrap items-center justify-center gap-x-[52px] gap-y-3 font-mono text-[11px] uppercase tracking-[0.22em] lg:justify-start ${
              isDark ? "text-[#93877a]" : "text-muted"
            }`}
          >
            <span>7-Stage Pipeline</span>
            <span>4 Models Compared</span>
            <span>PDF · CSV · XLSX</span>
          </motion.div>
          </div>

          <div className="relative mx-auto mt-12 h-[320px] w-full max-w-[560px] sm:h-[380px] xl:hidden">
            <SceneBoundary>
              <Suspense
                fallback={
                  <div className="flex h-full w-full items-center justify-center font-mono text-[9px] uppercase tracking-[0.18em] text-muted">
                    Preparing 3D core…
                  </div>
                }
              >
                <FusionScene3D />
              </Suspense>
            </SceneBoundary>
          </div>
          <div className="relative mb-4 mt-3 flex justify-center xl:hidden">
            <SceneHud className="relative h-4 w-full max-w-[560px]" />
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-[1320px] px-4 sm:px-6 lg:px-8">
        <section className="pb-20 pt-6">
          <div className="flex flex-col gap-6 pb-10 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <SectionLabel>What the engine does</SectionLabel>
              <h2 className="mt-5 max-w-[520px] font-display text-[clamp(2rem,3.8vw,2.9rem)] leading-[1.04] text-ink">
                Eight capabilities, one traceable pipeline.
              </h2>
            </div>
            <p className="max-w-[520px] text-[17px] leading-[1.6] text-muted">
              Hover a card to flip it. Every description maps to functionality you can verify on the fusion and
              results pages.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((feature, index) => (
              <FeatureCard key={feature.title} feature={feature} index={index} />
            ))}
          </div>
        </section>

        <Workflow />

        <section className="flex flex-col items-start justify-between gap-6 border-t border-line py-12 sm:flex-row sm:items-center">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-line text-accent">
              <BarChart3 size={17} />
            </span>
            <div>
              <p className="font-display text-[15px] text-ink">Ready to fuse your own sources?</p>
              <p className="text-[12px] text-muted">Upload your own CSV, Excel, JSON or TSV files to begin.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Badge tone="accent">Deterministic · seed 42</Badge>
            <Button variant="secondary" size="sm" onClick={() => navigate("/upload")} icon={<ArrowUpRight size={13} />}>
              Open upload
            </Button>
          </div>
        </section>
      </div>
    </div>
  );
}
