import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'curitiba:presentation-session';

interface PresentationSession {
  active: boolean;
  startedAt: number | null;
}

interface PresentationContextValue extends PresentationSession {
  start: () => void;
  stop: () => void;
  toggle: () => void;
}

const PresentationContext = createContext<PresentationContextValue | null>(null);

function readSession(): PresentationSession {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as Partial<PresentationSession> | null;
    return {
      active: stored?.active === true,
      startedAt: typeof stored?.startedAt === 'number' ? stored.startedAt : null,
    };
  } catch {
    return { active: false, startedAt: null };
  }
}

export function PresentationProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<PresentationSession>(readSession);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    document.documentElement.dataset.presentationMode = session.active ? 'active' : 'inactive';
    return () => { delete document.documentElement.dataset.presentationMode; };
  }, [session]);

  const start = useCallback(() => setSession({ active: true, startedAt: Date.now() }), []);
  const stop = useCallback(() => setSession({ active: false, startedAt: null }), []);
  const toggle = useCallback(() => setSession((current) => (
    current.active
      ? { active: false, startedAt: null }
      : { active: true, startedAt: Date.now() }
  )), []);

  const value = useMemo(() => ({ ...session, start, stop, toggle }), [session, start, stop, toggle]);
  return <PresentationContext.Provider value={value}>{children}</PresentationContext.Provider>;
}

export function usePresentationMode() {
  const context = useContext(PresentationContext);
  if (!context) throw new Error('usePresentationMode must be used inside PresentationProvider');
  return context;
}
