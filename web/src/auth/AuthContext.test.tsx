import type { Session } from '@supabase/supabase-js';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { authenticatedReadCache } from '../services/authenticatedReadCache';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(), getUser: vi.fn(), signOut: vi.fn(),
  listener: null as ((event: string, session: Session | null) => void) | null,
}));
vi.mock('../services/supabase', () => ({ supabase: { auth: {
  getSession: auth.getSession, getUser: auth.getUser, signOut: auth.signOut,
  onAuthStateChange: (listener: typeof auth.listener) => {
    auth.listener = listener;
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  },
} } }));

import { AuthProvider, isSessionRejected, useAuth } from './AuthContext';

const session = (id: string) => ({ user: { id }, access_token: `synthetic-${id}` } as Session);
function Probe() {
  const authContext = useAuth();
  const label = authContext.loading ? 'loading'
    : authContext.status === 'unavailable' ? 'unavailable'
      : authContext.user?.id || 'signed-out';
  return <><span>{label}</span>
    <button onClick={() => void authContext.signOut()}>Sair</button>
    <button onClick={authContext.retrySessionCheck}>Tentar</button></>;
}
beforeEach(() => {
  authenticatedReadCache.reset();
  vi.clearAllMocks();
  auth.getSession.mockResolvedValue({ data: { session: session('user-A') } });
  auth.getUser.mockResolvedValue({ data: { user: { id: 'user-A' } } });
  auth.signOut.mockResolvedValue({ error: null });
});
afterEach(cleanup);

it('troca de usuário pelo evento de autenticação limpa leituras anteriores', async () => {
  render(<AuthProvider><Probe /></AuthProvider>);
  await screen.findByText('user-A');
  await authenticatedReadCache.read('employees', 30_000, async () => 'dados A');
  act(() => auth.listener?.('SIGNED_IN', session('user-B')));
  expect(screen.getByText('user-B')).toBeInTheDocument();
  expect(await authenticatedReadCache.read('employees', 30_000, async () => 'dados B')).toBe('dados B');
});

it('logout invalida resposta em voo mesmo sem evento SIGNED_OUT', async () => {
  render(<AuthProvider><Probe /></AuthProvider>);
  await screen.findByText('user-A');
  let finish!: (value: string) => void;
  const request = authenticatedReadCache.read('employees', 30_000, () => new Promise<string>((resolve) => { finish = resolve; }));
  const rejected = expect(request).rejects.toThrow('AUTH_SESSION_CHANGED');
  fireEvent.click(screen.getByRole('button', { name: 'Sair' }));
  await screen.findByText('signed-out');
  finish('dados A');
  await rejected;
});

it('verificação inicial tardia não restaura a sessão anterior após um novo login', async () => {
  let finish!: (value: { data: { user: { id: string } } }) => void;
  auth.getUser.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  render(<AuthProvider><Probe /></AuthProvider>);
  // Let getSession resolve and the verification of user A begin.
  await act(async () => { await Promise.resolve(); });
  expect(auth.getUser).toHaveBeenCalled();
  act(() => auth.listener?.('SIGNED_IN', session('user-B')));
  await authenticatedReadCache.read('employees', 30_000, async () => 'dados B');
  await act(async () => { finish({ data: { user: { id: 'user-A' } } }); });
  expect(screen.getByText('user-B')).toBeInTheDocument();
  const loader = vi.fn(async () => 'cache reset indevido');
  expect(await authenticatedReadCache.read('employees', 30_000, loader)).toBe('dados B');
  expect(loader).not.toHaveBeenCalled();
});

it('falha de rede ao validar mantém a sessão salva e permite tentar de novo', async () => {
  auth.getUser.mockResolvedValueOnce({
    data: { user: null },
    error: { name: 'AuthRetryableFetchError', status: 0, message: 'Failed to fetch' },
  });
  render(<AuthProvider><Probe /></AuthProvider>);
  await screen.findByText('unavailable');
  expect(auth.signOut).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: 'Tentar' }));
  await screen.findByText('user-A');
  expect(auth.signOut).not.toHaveBeenCalled();
});

it('serviço de login fora do ar (5xx) não é tratado como sessão inválida', async () => {
  auth.getSession.mockResolvedValueOnce({
    data: { session: null },
    error: { name: 'AuthRetryableFetchError', status: 503, message: 'Service Unavailable' },
  });
  render(<AuthProvider><Probe /></AuthProvider>);
  await screen.findByText('unavailable');
  expect(auth.signOut).not.toHaveBeenCalled();
});

it('sessão recusada pelo Supabase é descartada localmente', async () => {
  auth.getUser.mockResolvedValueOnce({
    data: { user: null },
    error: { name: 'AuthApiError', status: 403, message: 'invalid JWT' },
  });
  render(<AuthProvider><Probe /></AuthProvider>);
  await screen.findByText('signed-out');
  expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
});

it('classifica apenas respostas de sessão inválida como rejeição', () => {
  expect(isSessionRejected({ status: 401 })).toBe(true);
  expect(isSessionRejected({ status: 403 })).toBe(true);
  expect(isSessionRejected({ status: 0 })).toBe(false);
  expect(isSessionRejected({ status: 429 })).toBe(false);
  expect(isSessionRejected({ status: 503 })).toBe(false);
  expect(isSessionRejected(new Error('AUTH_REQUEST_TIMEOUT'))).toBe(false);
  expect(isSessionRejected(null)).toBe(false);
});
