import { AnimatePresence, motion } from "framer-motion";
import { FileText, History, Menu, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Logo } from "./Logo";
import { Avatar, ThemeToggle } from "./ThemeToggle";

const links = [
  { label: "History", to: "/history", icon: History },
  { label: "Fusion Reports", to: "/reports", icon: FileText },
];

const navOrder = ["History", "Explore", "Fusion Reports"];

export function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const explore = () => {
    setOpen(false);
    if (location.pathname !== "/") {
      navigate("/#workflow");
      return;
    }
    document.getElementById("workflow")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const isActive = (to: string) => location.pathname === to;

  return (
    <header
      className={`sticky top-0 z-50 border-b bg-canvas/80 backdrop-blur-xl transition-all duration-300 ${
        scrolled ? "border-line shadow-[0_10px_30px_-30px_rgba(0,0,0,0.6)]" : "border-transparent"
      }`}
    >
      <div className="mx-auto flex h-[88px] w-full max-w-[1400px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-5">
        <Logo />

        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {navOrder.map((label) =>
            label === "Explore" ? (
              <button
                key="Explore"
                type="button"
                onClick={explore}
                className="group flex items-center gap-1.5 rounded-full px-5 py-2 text-[14.5px] text-muted transition hover:text-ink"
              >
                <Sparkles size={13} className="text-accent opacity-0 transition group-hover:opacity-100" />
                Explore
              </button>
            ) : (
              (() => {
                const link = links.find((item) => item.label === label)!;
                return (
                  <Link
                    key={link.to}
                    to={link.to}
                    className={`relative rounded-full px-5 py-2 text-[14.5px] transition-colors ${
                      isActive(link.to) ? "font-medium text-ink" : "text-muted hover:text-ink"
                    }`}
                  >
                    {link.label}
                    {isActive(link.to) && (
                      <motion.span
                        layoutId="nav-active"
                        className="absolute inset-x-3 -bottom-[1px] h-[2px] rounded-full bg-accent"
                        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                      />
                    )}
                  </Link>
                );
              })()
            ),
          )}
        </nav>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Avatar />
          <button
            type="button"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink transition hover:border-accent/60 hover:text-accent md:hidden"
          >
            {open ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden border-t border-line bg-canvas md:hidden"
          >
            <nav className="mx-auto flex w-full max-w-[1240px] flex-col gap-1 px-4 py-3" aria-label="Mobile">
              {links.map((link) => {
                const Icon = link.icon;
                return (
                  <Link
                    key={link.to}
                    to={link.to}
                    className="flex items-center gap-3 rounded-xl px-3 py-3 text-[14px] text-ink transition hover:bg-surface-2"
                  >
                    <Icon size={15} className="text-accent" /> {link.label}
                  </Link>
                );
              })}
              <button
                type="button"
                onClick={explore}
                className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-[14px] text-ink transition hover:bg-surface-2"
              >
                <Sparkles size={15} className="text-accent" /> Explore the workflow
              </button>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
