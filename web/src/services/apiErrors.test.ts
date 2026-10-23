import { describe, expect, it } from 'vitest';

import { describeApiError, toApiError } from './apiErrors';

const httpError = (status: number, data?: unknown) => ({ response: { status, data } });

describe('mensagens de erro da API', () => {
  it('distingue sessão expirada, permissão e indisponibilidade', () => {
    expect(describeApiError(httpError(401), 'listar as obras')).toContain('sessão expirou');
    expect(describeApiError(httpError(403), 'listar as obras')).toContain('não tem permissão para listar as obras');
    expect(describeApiError(httpError(503), 'listar as obras')).toContain('não conseguiu listar as obras');
    expect(describeApiError({ code: 'ERR_NETWORK' }, 'listar as obras')).toContain('Sem conexão');
    expect(describeApiError(new Error('API_ROUTE_RETURNED_HTML'), 'listar as obras')).toContain('VITE_API_URL');
  });

  it('mostra a mensagem do validador do servidor para o campo recusado', () => {
    const body = { error: { code: 'REQUEST_VALIDATION_FAILED', message: 'A requisicao contem campos invalidos', details: { errors: [
      { location: ['body', 'camera', 'name'], message: 'String should have at least 2 characters' },
      { location: ['body', 'camera', 'ip_address'], message: 'Value error, Informe o IP da camera no formato 192.168.0.10' },
    ] } } };
    expect(describeApiError(httpError(422, body), 'salvar a câmera')).toBe('Informe o IP da camera no formato 192.168.0.10.');
  });

  it('não repete mensagens em inglês nem detalhes de erros 5xx', () => {
    const english = { error: { message: 'A requisicao contem campos invalidos', details: { errors: [{ message: 'Field required' }] } } };
    expect(toApiError(httpError(422, english)).serverMessage).toBe('A requisicao contem campos invalidos');
    const internal = { error: { message: 'duplicate key value violates unique constraint' } };
    expect(toApiError(httpError(500, internal)).serverMessage).toBe(null);
    expect(toApiError(httpError(422, { error: { details: { errors: 'malformed' } } })).serverMessage).toBe(null);
  });

  it('usa o texto do código de conflito conhecido', () => {
    const body = { error: { code: 'WORKSITE_CODE_CONFLICT', message: 'Ja existe uma obra com este codigo' } };
    expect(describeApiError(httpError(409, body), 'cadastrar a obra')).toBe('Já existe uma obra com este código.');
  });
});
