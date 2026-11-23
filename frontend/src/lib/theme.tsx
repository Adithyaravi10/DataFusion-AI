import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type Theme = "light" | "dark";

interface ThemeContextValue {
  theme: Theme;
  isDark: boolean;
  toggle: () => void;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readInitialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem("df-theme");
  if (stored === "dark" || stored === "light") return stored;
  return "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("df-theme", theme);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);
  const toggle = useCallback(() => setThemeState((prev) => (prev === "dark" ? "light" : "dark")), []);

  const value = useMemo(
    () => ({ theme, isDark: theme === "dark", toggle, setTheme }),
    [theme, toggle, setTheme],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used inside ThemeProvider");
  return context;
}

export interface ChartPalette {
  colors: string[];
  accent: string;
  stone: string;
  ink: string;
  muted: string;
  grid: string;
  surface: string;
  tooltipBg: string;
  tooltipBorder: string;
  positive: string;
  negative: string;
}

export function useChartPalette(): ChartPalette {
  const { isDark } = useTheme();
  return useMemo(
    () =>
      isDark
        ? {
            colors: ["#d17b4e", "#b7a696", "#8f8376", "#e6ded4", "#83ad8e"],
            accent: "#d17b4e",
            stone: "#b7a696",
            ink: "#f0ebe3",
            muted: "#a1978a",
            grid: "#2a2521",
            surface: "#12100d",
            tooltipBg: "#17130f",
            tooltipBorder: "rgba(208,208,208,0.2)",
            positive: "#d17b4e",
            negative: "#8f8376",
          }
        : {
            colors: ["#aa592f", "#463635", "#908779", "#bcbaba", "#3d6b4f"],
            accent: "#aa592f",
            stone: "#908779",
            ink: "#0b0a09",
            muted: "#6e675d",
            grid: "#dcd5c9",
            surface: "#f8f5f0",
            tooltipBg: "#f8f5f0",
            tooltipBorder: "#d3ccc0",
            positive: "#aa592f",
            negative: "#463635",
          },
    [isDark],
  );
}
