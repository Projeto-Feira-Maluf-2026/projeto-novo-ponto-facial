import type { User } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { roleForUser, userHasRole } from './permissions';

const user = (app_metadata: Record<string, unknown>, user_metadata: Record<string, unknown> = {}) => (
  { app_metadata, user_metadata } as User
);

describe('permissões exibidas pelo frontend', () => {
  it('não concede acesso administrativo através de metadados editáveis pelo usuário', () => {
    const forged = user({}, { role: 'SUPER_ADMIN' });
    expect(roleForUser(forged)).toBe('FUNCIONARIO');
    expect(userHasRole(forged, ['SUPER_ADMIN', 'RH'])).toBe(false);
  });

  it('respeita somente a função atribuída nos metadados administrativos', () => {
    expect(roleForUser(user({ role: 'RH' }, { role: 'SUPER_ADMIN' }))).toBe('RH');
    expect(userHasRole(user({ role: 'GESTOR_OBRA' }), ['GESTOR_OBRA'])).toBe(true);
  });

  it('usa a função mínima quando ausente ou inválida', () => {
    expect(roleForUser(null)).toBe('FUNCIONARIO');
    expect(roleForUser(user({ role: 'INVALID' }))).toBe('FUNCIONARIO');
  });
});
