import { describe, expect, it, vi } from 'vitest';
import { createAuthenticatedReadCache } from './authenticatedReadCache';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

describe('cache de leituras autenticadas', () => {
  it('deduplica leituras dentro da mesma sessão e preserva o TTL', async () => {
    const cache = createAuthenticatedReadCache();
    const pending = deferred<string>();
    const loader = vi.fn(() => pending.promise);
    const first = cache.read('employees', 30_000, loader);
    const second = cache.read('employees', 30_000, loader);
    expect(second).toBe(first);
    pending.resolve('sessão A');
    await first;
    expect(await cache.read('employees', 30_000, loader)).toBe('sessão A');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('não reutiliza dados do usuário anterior depois de trocar sessão', async () => {
    const cache = createAuthenticatedReadCache();
    await cache.read('employees', 30_000, async () => 'dados A');
    cache.reset();
    expect(await cache.read('employees', 30_000, async () => 'dados B')).toBe('dados B');
  });

  it('rejeita resposta antiga em voo e preserva o cache da nova sessão', async () => {
    const cache = createAuthenticatedReadCache();
    const old = deferred<string>();
    const oldRequest = cache.read('employees', 30_000, () => old.promise);
    const rejected = expect(oldRequest).rejects.toThrow('AUTH_SESSION_CHANGED');
    cache.reset();
    await cache.read('employees', 30_000, async () => 'dados B');
    old.resolve('dados A');
    await rejected;
    const loader = vi.fn(async () => 'não deveria carregar');
    expect(await cache.read('employees', 30_000, loader)).toBe('dados B');
    expect(loader).not.toHaveBeenCalled();
  });

  it('erro de leitura antiga não apaga leitura em voo da nova sessão', async () => {
    const cache = createAuthenticatedReadCache();
    const old = deferred<string>();
    const next = deferred<string>();
    const oldRequest = cache.read('employees', 30_000, () => old.promise);
    const rejected = expect(oldRequest).rejects.toThrow('erro antigo');
    cache.reset();
    const nextRequest = cache.read('employees', 30_000, () => next.promise);
    old.reject(new Error('erro antigo'));
    await rejected;
    expect(cache.read('employees', 30_000, async () => 'duplicado')).toBe(nextRequest);
    next.resolve('dados B');
    await nextRequest;
  });

  it('resposta anterior à mutação não repopula dados invalidados', async () => {
    const cache = createAuthenticatedReadCache();
    const old = deferred<string>();
    const request = cache.read('employees', 30_000, () => old.promise);
    cache.invalidate('employees');
    old.resolve('antes da mutação');
    await request;
    expect(await cache.read('employees', 30_000, async () => 'depois da mutação')).toBe('depois da mutação');
  });
});
