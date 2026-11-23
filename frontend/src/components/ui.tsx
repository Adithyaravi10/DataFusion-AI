import { motion } from "framer-motion";
import { ArrowRight, Info, Loader2, RotateCw } from "lucide-react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "accent" | "secondary" | "ghost" | "subtle";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
}

const buttonStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-ink border border-transparent hover:-translate-y-0.5 hover:shadow-lift",
  accent:
    "bg-accent text-[#fff8f2] border border-transparent hover:bg-accent-strong hover:-translate-y-0.5 hover:shadow-glow",
  secondary:
    "border border-line bg-transparent text-ink hover:border-accent/70 hover:text-accent hover:-translate-y-0.5",
  ghost: "border border-transparent text-muted hover:bg-surface-2 hover:text-ink",
  subtle: "border border-line bg-surface-2 text-ink hover:border-accent/50",
};

const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-[12.5px]",
  md: "h-11 px-5 text-[13.5px]",
  lg: "h-12 px-6 text-[14px]",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-pill font-medium tracking-[-0.01em] transition-all duration-300 ease-expo disabled:pointer-events-none disabled:opacity-55 ${buttonStyles[variant]} ${buttonSizes[size]} ${className}`}
    >
      {loading ? <Loader2 size={15} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

export function Badge({
  children,
  tone = "neutral",
  className = "",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "success" | "warning" | "danger" | "dark";
  className?: string;
}) {
  const tones = {
    neutral: "border-line bg-surface-2 text-muted",
    accent: "border-accent/25 bg-accent-soft text-accent",
    success: "border-success/25 bg-success/10 text-success",
    warning: "border-warning/25 bg-warning/10 text-warning",
    danger: "border-danger/25 bg-danger/10 text-danger",
    dark: "border-white/15 bg-white/10 text-[#f3eee7]",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-medium uppercase tracking-[0.12em] ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function SectionLabel({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.22em] ${
        light ? "text-[#b9ada1]" : "text-muted"
      }`}
    >
      <span className={`h-1 w-1 rounded-full ${light ? "bg-[#d17b4e]" : "bg-accent"}`} />
      {children}
    </div>
  );
}

export function Card({
  children,
  className = "",
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div
      {...rest}
      className={`rounded-card border border-line bg-surface ${className}`}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 pb-8 pt-10 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-2xl">
        {eyebrow && <SectionLabel>{eyebrow}</SectionLabel>}
        <h1 className="mt-3 font-display text-[clamp(1.8rem,4vw,2.6rem)] leading-[1.04] text-ink">{title}</h1>
        {description && <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StepHeader({
  step,
  title,
  description,
  actions,
}: {
  step?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {step && <SectionLabel>{step}</SectionLabel>}
        <h1 className="mt-2 font-display text-[clamp(1.6rem,3vw,2.1rem)] text-ink">{title}</h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-[12.5px] leading-relaxed text-muted">{description}</p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Small info affordance: keeps long explanations out of the layout until asked for. */
export function InfoTip({
  label,
  children,
  align = "center",
  className = "",
}: {
  label: string;
  children: ReactNode;
  align?: "center" | "start" | "end";
  className?: string;
}) {
  const alignment = {
    center: "left-1/2 -translate-x-1/2",
    start: "left-0",
    end: "right-0",
  }[align];
  return (
    <span className={`group relative inline-flex align-middle ${className}`}>
      <button
        type="button"
        aria-label={label}
        className="flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-full border border-line text-muted transition hover:border-accent hover:text-accent focus:border-accent focus:text-accent focus:outline-none"
      >
        <Info size={10} />
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute top-full z-40 mt-2 hidden w-60 max-w-[72vw] rounded-lg border border-line bg-surface px-3 py-2 text-left text-[10.5px] font-normal normal-case leading-relaxed tracking-normal text-muted shadow-lift group-hover:block group-focus-within:block ${alignment}`}
      >
        {children}
      </span>
    </span>
  );
}

export function Spinner({ size = 18, label }: { size?: number; label?: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[12px] text-muted">
      <Loader2 size={size} className="animate-spin text-accent" />
      {label}
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`shimmer rounded-lg ${className}`} />;
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: "default" | "accent";
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className={`rounded-card border p-5 ${
        tone === "accent"
          ? "border-accent/30 bg-accent-soft/60"
          : "border-line bg-surface"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">{label}</p>
        {icon && <span className="text-accent">{icon}</span>}
      </div>
      <p className="mt-3 font-display text-[1.65rem] leading-none tracking-[-0.04em] text-ink">{value}</p>
      {hint && <p className="mt-2 text-[11.5px] leading-snug text-muted">{hint}</p>}
    </motion.div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className = "",
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-card border border-dashed border-line bg-surface/60 px-6 py-14 text-center ${className}`}
    >
      {icon && (
        <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-accent/25 bg-accent-soft text-accent">
          {icon}
        </span>
      )}
      <h3 className="font-display text-lg text-ink">{title}</h3>
      {description && <p className="mt-2 max-w-md text-[13px] leading-relaxed text-muted">{description}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function ErrorPanel({
  title = "Something went wrong",
  message,
  onRetry,
  className = "",
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={`rounded-card border border-danger/30 bg-danger/5 p-5 ${className}`} role="alert">
      <p className="text-[13px] font-semibold text-danger">{title}</p>
      <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink/80">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-1.5 rounded-pill border border-line bg-surface px-3 py-1.5 text-[11.5px] font-medium transition hover:border-accent hover:text-accent"
        >
          <RotateCw size={12} /> Try again
        </button>
      )}
    </div>
  );
}

export function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className={`h-1.5 w-full overflow-hidden rounded-full bg-surface-2 ${className}`}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-500 ease-expo"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export function LinkArrow({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent">
      {children}
      <ArrowRight size={13} />
    </span>
  );
}
