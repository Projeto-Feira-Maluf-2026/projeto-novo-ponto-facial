type CachedRead = { expiresAt: number; value?: unknown; inFlight?: Promise<unknown> };

export function createAuthenticatedReadCache() {
  const entries = new Map<string, CachedRead>();
  let generation = 0;
  return {
    reset() {
      generation += 1;
      entries.clear();
    },
    invalidate(...prefixes: string[]) {
      for (const key of entries.keys()) {
        if (prefixes.some((prefix) => key.startsWith(prefix))) entries.delete(key);
      }
    },
    read<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
      const cached = entries.get(key);
      if (cached?.value !== undefined && cached.expiresAt > Date.now()) {
        return Promise.resolve(cached.value as T);
      }
      if (cached?.inFlight) return cached.inFlight as Promise<T>;
      const requestGeneration = generation;
      const entry: CachedRead = { expiresAt: 0 };
      const inFlight = loader().then((value) => {
        // A response from a previous authentication session must never reach
        // the new session's UI or repopulate its cache.
        if (requestGeneration !== generation) throw new Error('AUTH_SESSION_CHANGED');
        if (entries.get(key) === entry) {
          entries.set(key, { value, expiresAt: Date.now() + ttlMs });
        }
        return value;
      }).catch((error) => {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      });
      entry.inFlight = inFlight;
      entries.set(key, entry);
      return inFlight;
    },
  };
}

export const authenticatedReadCache = createAuthenticatedReadCache();
