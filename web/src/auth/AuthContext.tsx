import type { Session, User } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { supabase } from '../services/supabase';
import { authenticatedReadCache } from '../services/authenticatedReadCache';

interface AuthContextValue {
  loading: boolean;
  session: Session | null;
  user: User | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
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
  const [loading, setLoading] = useState(!mocksEnabled);
  const publishSession = useCallback((nextSession: Session | null) => {
    authenticatedReadCache.reset();
    setSession(nextSession);
  }, []);

  useEffect(() => {
    if (mocksEnabled) return undefined;
    let active = true;
    let authRevision = 0;

    const initialize = async () => {
      const initialRevision = authRevision;
      const isCurrent = () => active && initialRevision === authRevision;
      try {
        const { data, error: sessionError } = await withTimeout(supabase.auth.getSession());
        if (!isCurrent()) return;
        if (sessionError || !data.session) {
          publishSession(null);
          return;
        }

        const { data: verified, error } = await withTimeout(supabase.auth.getUser());
        if (!isCurrent()) return;
        if (error || !verified.user) {
          await supabase.auth.signOut({ scope: 'local' });
          if (!isCurrent()) return;
          publishSession(null);
        } else {
          publishSession(data.session);
        }
      } catch {
        if (!isCurrent()) return;
        await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
        if (isCurrent()) publishSession(null);
      } finally {
        if (isCurrent()) setLoading(false);
      }
    };

    void initialize();

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      // The initial locally cached session is verified by getUser above before
      // protected routes are rendered.
      if (event === 'INITIAL_SESSION') return;
      authRevision += 1;
      publishSession(nextSession);
      setLoading(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [publishSession]);

  const value = useMemo<AuthContextValue>(() => ({
    loading,
    session,
    user: session?.user ?? null,
    signIn: async (email: string, password: string) => {
      if (mocksEnabled) {
        publishSession(mockSession);
        setLoading(false);
        return;
      }
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
      );
      if (error) throw error;
      if (!data.session) throw new Error('AUTH_SESSION_NOT_CREATED');
      publishSession(data.session);
      setLoading(false);
    },
    signOut: async () => {
      authenticatedReadCache.reset();
      try {
        const { error } = await withTimeout(supabase.auth.signOut({ scope: 'local' }));
        if (error) throw error;
      } finally {
        publishSession(null);
        setLoading(false);
      }
    },
  }), [loading, session, publishSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return context;
}
