import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Navbar } from "./components/Navbar";
import { Dashboard } from "./pages/Dashboard";
import { UploadPage } from "./pages/Upload";
import { FusionProcess } from "./pages/FusionProcess";
import { HistoryPage } from "./pages/History";
import { FusionReportsPage } from "./pages/FusionReports";
import { Workspace } from "./pages/Workspace";

function ScrollManager() {
  const location = useLocation();
  useEffect(() => {
    if (location.hash === "#workflow") {
      const timer = window.setTimeout(() => {
        document.getElementById("workflow")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 120);
      return () => window.clearTimeout(timer);
    }
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [location.pathname, location.hash]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollManager />
      <div className="flex min-h-screen flex-col">
        <Navbar />
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/fusion/:jobId" element={<FusionProcess />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/reports" element={<FusionReportsPage />} />
            <Route path="/workspace/:sessionId" element={<Navigate to="dashboard" replace />} />
            <Route path="/workspace/:sessionId/:tab" element={<Workspace />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <footer className="border-t border-line">
          <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-2 px-4 py-6 text-[11px] text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
            <span>DataFusion AI — Multi-Source Data Fusion Engine</span>
            <span className="font-mono uppercase tracking-[0.16em]">FastAPI · React · scikit-learn</span>
          </div>
        </footer>
      </div>
    </BrowserRouter>
  );
}
