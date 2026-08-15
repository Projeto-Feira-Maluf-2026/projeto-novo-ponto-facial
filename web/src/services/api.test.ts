import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveApiBaseUrl } from './api';

describe('resolveApiBaseUrl', () => {
  afterEach(() => vi.restoreAllMocks());

  it('preserva rotas relativas para funcionar em qualquer computador', () => {
    expect(resolveApiBaseUrl('/api/v1/', '/api/v1')).toBe('/api/v1');
  });

  it('recusa uma URL inválida e usa a rota segura do mesmo domínio', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(resolveApiBaseUrl('api-sem-protocolo', '/api/v1')).toBe('/api/v1');
    expect(console.warn).toHaveBeenCalledOnce();
  });

  it('recusa HTTP quando a página usa HTTPS', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(resolveApiBaseUrl('http://api.example.test', '/api/v1')).toBe('/api/v1');
    expect(console.warn).toHaveBeenCalledOnce();
  });
});
