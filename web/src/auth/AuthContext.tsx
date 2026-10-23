import type { Session, User } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { supabase } from '../services/supabase';
import { authenticatedReadCache } from '../services/authenticatedReadCache';

/**
 * - checking: the stored session is being verified with Supabase.
 * - ready: verification finished (signed in or signed out).
 * - unavailable: Supabase could not be reached or timed out. The stored session is
 *   kept so a site tablet does not lose its login during a network outage.
 */
export type AuthStatus = 'checking' | 'ready' | 'unavailable';

interface AuthContextValue {
  loading: boolean;
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Verifies the stored session again after an outage. */
  retrySessionCheck: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const AUTH_REQUEST_TIMEOUT_MS = 10_000;
const mocksEnabled = import.meta.env.VITE_ENABLE_MOCKS === 'true';
const mockUser = {
  id: 'local-preview-user',
  email: 'operador@preview.local',
  app_metadata: { role: 'SUPER_ADMIN' },
  user_metadata: { name: 'Operador de teste' },
} as unknown as User;
const mockSession = {
  access_token: 'local-preview-token',
  refresh_token: 'local-preview-refresh-token',
  expires_in: 3_600,
  token_type: 'bearer',
  user: mockUser,
} as Session;

// Answers that mean the stored session itself is invalid. Anything else (no status,
// 0, 408, 429, 5xx, timeout) is treated as the service being unreachable.
const SESSION_REJECTED_STATUSES = new Set([400, 401, 403, 404, 422]);

export function isSessionRejected(error: unknown): boolean {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  return typeof status === 'number' && SESSION_REJECTED_STATUSES.has(status);
}

function withTimeout<T>(operation: PromiseLike<T>, timeoutMs = AUTH_REQUEST_TIMEOUT_MS): Promise<T> {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(
      () => reject(new Error('AUTH_REQUEST_TIMEOUT')),
      timeoutMs,
    );
  });

  return Promise.race([Promise.resolve(operation), timeout]).finally(() => {
    if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(mocksEnabled ? mockSession : null);
  const [status, setStatus] = useState<AuthStatus>(mocksEnabled ? 'ready' : 'checking');
  const [verificationAttempt, setVerificationAttempt] = useState(0);
  // Bumped by every auth event so a slow verification cannot overwrite a newer login.
  const authRevisionRef = useRef(0);
  const publishSession = useCallback((nextSession: Session | null) => {
    authenticatedReadCache.reset();
    setSession(nextSession);
  }, []);

  useEffect(() => {
    if (mocksEnabled) return undefined;
    let active = true;
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      // The initial locally cached session is verified by getUser below before
      // protected routes are rendered.
      if (event === 'INITIAL_SESSION') return;
      authRevisionRef.current += 1;
      publishSession(nextSession);
      setStatus('ready');
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [publishSession]);

  useEffect(() => {
    if (mocksEnabled) return undefined;
    let active = true;
    const initialRevision = authRevisionRef.current;
    const isCurrent = () => active && initialRevision === authRevisionRef.current;
    setStatus('checking');

    const rejectStoredSession = async () => {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
      if (!isCurrent()) return;
      publishSession(null);
      setStatus('ready');
    };
    const reportUnavailable = () => {
      // Keep the stored tokens: they are still valid once the network returns.
      if (!isCurrent()) return;
      publishSession(null);
      setStatus('unavailable');
    };

    const verify = async () => {
      try {
        const { data, error: sessionError } = await withTimeout(supabase.auth.getSession());
        if (!isCurrent()) return;
        if (sessionError) {
          if (isSessionRejected(sessionError)) await rejectStoredSession();
          else reportUnavailable();
          return;
        }
        if (!data.session) {
          publishSession(null);
          setStatus('ready');
          return;
        }

        const { data: verified, error } = await withTimeout(supabase.auth.getUser());
        if (!isCurrent()) return;
        if (error && !isSessionRejected(error)) {
          reportUnavailable();
        } else if (error || !verified.user) {
          await rejectStoredSession();
        } else {
          publishSession(data.session);
          setStatus('ready');
        }
      } catch {
        // Timeout or a thrown network failure: the session was not proven invalid.
        reportUnavailable();
      }
    };

    void verify();
    return () => {
      active = false;
    };
  }, [publishSession, verificationAttempt]);

  const retrySessionCheck = useCallback(() => {
    setVerificationAttempt((current) => current + 1);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    loading: status === 'checking',
    status,
    session,
    user: session?.user ?? null,
    signIn: async (email: string, password: string) => {
      if (mocksEnabled) {
        publishSession(mockSession);
        setStatus('ready');
        return;
      }
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
      );
      if (error) throw error;
      if (!data.session) throw new Error('AUTH_SESSION_NOT_CREATED');
      authRevisionRef.current += 1;
      publishSession(data.session);
      setStatus('ready');
    },
    signOut: async () => {
      authenticatedReadCache.reset();
      try {
        const { error } = await withTimeout(supabase.auth.signOut({ scope: 'local' }));
        if (error) throw error;
      } finally {
        authRevisionRef.current += 1;
        publishSession(null);
        setStatus('ready');
      }
    },
    retrySessionCheck,
  }), [status, session, publishSession, retrySessionCheck]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return context;
}
