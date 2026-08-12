import type { Session, User } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

import { supabase } from '../services/supabase';

interface AuthContextValue {
  loading: boolean;
  session: Session | null;
  user: User | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);
const AUTH_REQUEST_TIMEOUT_MS = 10_000;

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
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const initialize = async () => {
      try {
        const { data, error: sessionError } = await withTimeout(supabase.auth.getSession());
        if (!active) return;
        if (sessionError || !data.session) {
          setSession(null);
          return;
        }

        const { data: verified, error } = await withTimeout(supabase.auth.getUser());
        if (!active) return;
        if (error || !verified.user) {
          await supabase.auth.signOut({ scope: 'local' });
          if (!active) return;
          setSession(null);
        } else {
          setSession(data.session);
        }
      } catch {
        if (!active) return;
        await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
        if (active) setSession(null);
      } finally {
        if (active) setLoading(false);
      }
    };

    void initialize();

    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      // The initial locally cached session is verified by getUser above before
      // protected routes are rendered.
      if (event === 'INITIAL_SESSION') return;
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    loading,
    session,
    user: session?.user ?? null,
    signIn: async (email: string, password: string) => {
      const { data, error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password }),
      );
      if (error) throw error;
      if (!data.session) throw new Error('AUTH_SESSION_NOT_CREATED');
      setSession(data.session);
      setLoading(false);
    },
    signOut: async () => {
      try {
        const { error } = await withTimeout(supabase.auth.signOut({ scope: 'local' }));
        if (error) throw error;
      } finally {
        setSession(null);
        setLoading(false);
      }
    },
  }), [loading, session]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return context;
}
