import { Download, Loader2 } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { useToast } from "../lib/toast";
import { useChartPalette } from "../lib/theme";

export function ChartCard({
  title,
  subtitle,
  children,
  filename,
  action,
  className = "",
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  filename: string;
  action?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const palette = useChartPalette();
  const toast = useToast();

  const download = async () => {
    if (!ref.current) return;
    setDownloading(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(ref.current, {
        backgroundColor: palette.surface,
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const dataUrl = canvas.toDataURL("image/png");
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `${filename}.png`;
      link.click();
      toast.show(`Downloaded ${filename}.png`, "success");
    } catch {
      toast.show("Could not export this chart as PNG.", "error");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className={`flex flex-col rounded-card border border-line bg-surface ${className}`}>
      <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h3 className="font-display text-[15px] text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[11.5px] leading-snug text-muted">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {action}
          <button
            type="button"
            onClick={download}
            disabled={downloading}
            aria-label={`Download ${title} as PNG`}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-line text-muted transition hover:border-accent/60 hover:text-accent disabled:opacity-50"
          >
            {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          </button>
        </div>
      </div>
      <div ref={ref} className="flex-1 p-4 sm:p-5">
        {children}
      </div>
    </div>
  );
}
