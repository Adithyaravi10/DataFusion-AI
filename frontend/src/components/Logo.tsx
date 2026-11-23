import { Link } from "react-router-dom";

export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 44 44" className={className} fill="none" aria-hidden="true">
      <path d="M22 4 39 13 22 22 5 13 22 4Z" fill="currentColor" opacity="0.95" />
      <path d="M22 15 39 24 22 33 5 24 22 15Z" fill="currentColor" opacity="0.55" />
      <path d="M22 26 39 35 22 44 5 35 22 26Z" fill="currentColor" opacity="0.22" />
      <path d="M12 9.5 29 18.5M32 9.5 15 18.5" stroke="var(--surface)" strokeWidth="1.1" opacity="0.5" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      to="/"
      aria-label="DataFusion AI — back to dashboard"
      className="group flex items-center gap-2.5 rounded-full py-1 pr-2"
    >
      <span className="flex h-10 w-10 items-center justify-center rounded-full border border-line bg-surface text-ink transition group-hover:border-accent/60 group-hover:text-accent">
        <LogoMark className="h-[22px] w-[22px]" />
      </span>
      {!compact && (
        <span className="flex items-baseline gap-2">
          <span className="font-display text-[18px] font-semibold tracking-[-0.04em] text-ink">DataFusion</span>
          <span className="rounded-md border border-accent/60 px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-accent">
            AT
          </span>
        </span>
      )}
    </Link>
  );
}
