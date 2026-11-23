import { AnimatePresence, motion } from "framer-motion";
import {
  BarChart3,
  Bot,
  BrainCircuit,
  ChevronRight,
  FileDown,
  GitMerge,
  LayoutDashboard,
  LineChart,
  Lock,
  Menu,
  Plus,
  Sparkles,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge, Button, EmptyState, ErrorPanel, Skeleton } from "../components/ui";
import { api } from "../lib/api";
import { fmtInt } from "../lib/format";
import { useSession } from "../lib/session";
import type { Session } from "../lib/types";
import { AnalyseTab } from "./workspace/Analyse";
import { InsightsTab } from "./workspace/Insights";
import { ChartsTab } from "./workspace/Charts";
import { CleanDataTab } from "./workspace/CleanData";
import { CombineDataTab } from "./workspace/CombineData";
import { OverviewTab } from "./workspace/Overview";
import { PredictTab } from "./workspace/Predict";
import { ReportsTab } from "./workspace/Reports";
import { TrainTab } from "./workspace/Train";

const tabs = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard, step: "" },
  { key: "clean", label: "Clean Data", icon: Sparkles, step: "02" },
  { key: "combine", label: "Combine Data", icon: GitMerge, step: "03" },
  { key: "analyse", label: "Analyse Data", icon: BarChart3, step: "04" },
  { key: "charts", label: "View Charts", icon: LineChart, step: "05" },
  { key: "train", label: "Train Models", icon: BrainCircuit, step: "06" },
  { key: "ai", label: "AI Insights", icon: Bot, step: "07" },
  { key: "predict", label: "Predict", icon: Wand2, step: "08" },
  { key: "reports", label: "Reports", icon: FileDown, step: "09" },
] as const;

type TabKey = (typeof tabs)[number]["key"];

function SidebarNav({
  active,
  locked,
  onNavigate,
}: {
  active: string;
  locked: boolean;
  onNavigate: (key: TabKey) => void;
}) {
  return (
    <nav className="flex flex-col gap-1" aria-label="Workspace sections">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = active === tab.key;
        const isLocked = locked && tab.key !== "dashboard";
        return (
          <button
            key={tab.key}
            type="button"
            disabled={isLocked}
            aria-current={isActive ? "page" : undefined}
            onClick={() => onNavigate(tab.key)}
            className={`group flex items-center gap-3 rounded-full px-3.5 py-2.5 text-left text-[12.5px] transition-all duration-300 ${
              isActive
                ? "bg-accent font-medium text-[#fff8f2] shadow-[0_10px_26px_-18px_rgba(170,89,47,0.9)]"
                : isLocked
                  ? "cursor-not-allowed text-muted/55"
                  : "text-ink/75 hover:bg-surface-2 hover:text-ink"
            }`}
          >
            <Icon size={15} className={isActive ? "text-[#fff8f2]" : isLocked ? "text-muted/50" : "text-muted"} />
            <span className="flex-1">{tab.label}</span>
            {tab.step && (
              <span
                className={`font-mono text-[9px] tabular-nums ${
                  isActive ? "text-[#fff8f2]/55" : "text-muted/45"
                }`}
              >
                {tab.step}
              </span>
            )}
            {isLocked ? (
              <Lock size={11} className="text-muted/50" />
            ) : isActive ? (
              <ChevronRight size={12} className="text-[#fff8f2]/80" />
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

export function Workspace() {
  const { sessionId = "", tab = "dashboard" } = useParams();
  const navigate = useNavigate();
  const { sessionId: storedSession, setSession: remember } = useSession();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawer, setDrawer] = useState(false);

  const load = useCallback(async () => {
    try {
      const value = await api.session(sessionId);
      setSession(value);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load this session.");
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    setLoading(true);
    void load();
    if (sessionId && storedSession !== sessionId) remember(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    setDrawer(false);
  }, [tab]);

  const ready = session?.status === "ready";
  const locked = !ready;
  const activeTab = (tabs.find((item) => item.key === tab)?.key ?? "dashboard") as TabKey;

  const go = (key: TabKey) => {
    navigate(`/workspace/${sessionId}/${key}`);
    setDrawer(false);
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1240px] px-4 py-10 sm:px-6 lg:px-8">
        <Skeleton className="h-9 w-64" />
        <div className="mt-6 grid gap-5 lg:grid-cols-[230px_1fr]">
          <Skeleton className="hidden h-[420px] w-full rounded-card lg:block" />
          <div className="space-y-4">
            <Skeleton className="h-28 w-full rounded-card" />
            <Skeleton className="h-64 w-full rounded-card" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16">
        <ErrorPanel
          title="Session unavailable"
          message={error ?? "This workspace could not be found."}
          onRetry={() => void load()}
        />
        <div className="mt-4">
          <Button variant="secondary" size="sm" onClick={() => navigate("/upload")} icon={<Upload size={13} />}>
            Upload a new session
          </Button>
        </div>
      </div>
    );
  }

  const content: Record<TabKey, ReactNode> = {
    dashboard: <OverviewTab session={session} onNavigate={go} />,
    clean: <CleanDataTab sessionId={session.id} />,
    combine: <CombineDataTab sessionId={session.id} />,
    analyse: <AnalyseTab sessionId={session.id} />,
    charts: <ChartsTab sessionId={session.id} />,
    train: <TrainTab session={session} onRefresh={load} />,
    ai: <InsightsTab sessionId={session.id} />,
    predict: <PredictTab session={session} onNavigate={go} />,
    reports: <ReportsTab session={session} onRefresh={load} />,
  };

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 pb-20 pt-5 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted">
          <Link to="/" className="transition hover:text-ink">
            Dashboard
          </Link>
          <ChevronRight size={11} />
          <span className="truncate text-ink/80">{session.name}</span>
        </div>
        <div className="flex items-center gap-2">
          {session.fusion && (
            <Badge tone="accent">
              {fmtInt(session.fusion.final_rows)} × {session.fusion.final_columns}
            </Badge>
          )}
          <Button size="sm" variant="ghost" onClick={() => navigate("/upload")} icon={<Plus size={13} />}>
            New fusion
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[236px_minmax(0,1fr)]">
        <aside className="hidden lg:block">
          <div className="sticky top-[112px] rounded-card border border-line bg-surface p-4">
            <div className="mb-3 border-b border-line px-1 pb-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted">Workspace</p>
              <p className="mt-1.5 line-clamp-2 text-[12.5px] font-medium leading-snug text-ink">{session.name}</p>
              <div className="mt-2 flex items-center gap-2">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${ready ? "bg-success" : "bg-warning"}`}
                  aria-hidden="true"
                />
                <span className="text-[10.5px] text-muted">
                  {ready ? "Fused & ready" : session.status === "fusing" ? "Fusing…" : "Awaiting fusion"}
                </span>
              </div>
            </div>
            <SidebarNav active={activeTab} locked={locked} onNavigate={go} />
            {locked && (
              <p className="mt-4 rounded-xl border border-line bg-canvas p-3 text-[10.5px] leading-relaxed text-muted">
                Finish fusion to unlock the other sections.
              </p>
            )}
          </div>
        </aside>

        <div className="min-w-0">
          <div className="mb-4 flex items-center justify-between gap-3 lg:hidden">
            <button
              type="button"
              onClick={() => setDrawer(true)}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-line bg-surface px-3.5 text-[12px] text-ink"
            >
              <Menu size={14} /> Sections
            </button>
            <span className="text-[10.5px] text-muted">{ready ? "Fused & ready" : "Awaiting fusion"}</span>
          </div>

          {locked && activeTab !== "dashboard" ? (
            <EmptyState
              icon={<Lock size={20} />}
              title="This section is locked"
              description="Run the fusion pipeline first — a fused dataset unlocks every results section."
              action={
                session.job_id ? (
                  <Button size="sm" onClick={() => navigate(`/fusion/${session.job_id}`)}>
                    Continue fusion
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => navigate("/upload")} icon={<Upload size={13} />}>
                    Upload & fuse
                  </Button>
                )
              }
            />
          ) : (
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              {content[activeTab]}
            </motion.div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {drawer && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm lg:hidden"
            onClick={() => setDrawer(false)}
          >
            <motion.div
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              onClick={(event) => event.stopPropagation()}
              className="flex h-full w-[280px] flex-col border-r border-line bg-surface p-4"
              role="dialog"
              aria-modal="true"
              aria-label="Workspace navigation"
            >
              <div className="mb-4 flex items-center justify-between border-b border-line pb-3">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted">Workspace</p>
                  <p className="mt-1 line-clamp-2 text-[13px] font-medium text-ink">{session.name}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setDrawer(false)}
                  aria-label="Close navigation"
                  className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-muted"
                >
                  <X size={14} />
                </button>
              </div>
              <SidebarNav active={activeTab} locked={locked} onNavigate={go} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
