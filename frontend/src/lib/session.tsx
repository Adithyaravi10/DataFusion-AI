import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

interface SessionContextValue {
  sessionId: string | null;
  jobId: string | null;
  setSession: (sessionId: string | null) => void;
  setJob: (jobId: string | null) => void;
  clear: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);
const SESSION_KEY = "df-session";
const JOB_KEY = "df-job";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [sessionId, setSessionState] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  });
  const [jobId, setJobState] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(JOB_KEY);
    } catch {
      return null;
    }
  });

  const setSession = useCallback((next: string | null) => {
    setSessionState(next);
    try {
      if (next) window.localStorage.setItem(SESSION_KEY, next);
      else window.localStorage.removeItem(SESSION_KEY);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const setJob = useCallback((next: string | null) => {
    setJobState(next);
    try {
      if (next) window.localStorage.setItem(JOB_KEY, next);
      else window.localStorage.removeItem(JOB_KEY);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const clear = useCallback(() => {
    setSession(null);
    setJob(null);
  }, [setSession, setJob]);

  const value = useMemo(
    () => ({ sessionId, jobId, setSession, setJob, clear }),
    [sessionId, jobId, setSession, setJob, clear],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside SessionProvider");
  return context;
}
