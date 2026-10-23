import type { User } from '@supabase/supabase-js';

export type AppRole = 'SUPER_ADMIN' | 'RH' | 'GESTOR_OBRA' | 'SUPERVISOR' | 'FUNCIONARIO';

export const ALL_ROLES: AppRole[] = [
  'SUPER_ADMIN',
  'RH',
  'GESTOR_OBRA',
  'SUPERVISOR',
  'FUNCIONARIO',
];

const validRoles = new Set<AppRole>(ALL_ROLES);

export function roleForUser(user: User | null): AppRole {
  const metadataRole = user?.app_metadata?.role;
  const normalizedRole = String(metadataRole || 'FUNCIONARIO').toUpperCase() as AppRole;
  return validRoles.has(normalizedRole) ? normalizedRole : 'FUNCIONARIO';
}

export function userHasRole(user: User | null, roles: AppRole[]) {
  return roles.includes(roleForUser(user));
}

/**
 * Mirror of ROLE_SCOPES in api/app/core/permissions.py. The server remains the
 * authority; this map only hides actions the server would refuse, so people do
 * not fill a form just to receive "permissão insuficiente".
 * tests/test_frontend_permissions_contract.py fails if the two drift apart.
 */
export type AppScope =
  | 'dashboard:read'
  | 'employees:read'
  | 'employees:write'
  | 'employees:delete'
  | 'attendance:read'
  | 'attendance:write'
  | 'attendance:correct'
  | 'worksites:read'
  | 'worksites:write'
  | 'devices:read'
  | 'devices:write'
  | 'reports:export'
  | 'alerts:read'
  | 'audit:read';

const ALL_SCOPES: AppScope[] = [
  'dashboard:read',
  'employees:read',
  'employees:write',
  'employees:delete',
  'attendance:read',
  'attendance:write',
  'attendance:correct',
  'worksites:read',
  'worksites:write',
  'devices:read',
  'devices:write',
  'reports:export',
  'alerts:read',
  'audit:read',
];

export const ROLE_SCOPES: Record<AppRole, readonly AppScope[]> = {
  SUPER_ADMIN: ALL_SCOPES,
  RH: [
    'dashboard:read',
    'employees:read',
    'employees:write',
    'attendance:read',
    'attendance:write',
    'attendance:correct',
    'worksites:read',
    'reports:export',
    'alerts:read',
    'audit:read',
  ],
  GESTOR_OBRA: [
    'dashboard:read',
    'employees:read',
    'attendance:read',
    'attendance:write',
    'attendance:correct',
    'worksites:read',
    'devices:read',
    'reports:export',
    'alerts:read',
  ],
  SUPERVISOR: [
    'dashboard:read',
    'employees:read',
    'attendance:read',
    'attendance:write',
    'attendance:correct',
    'worksites:read',
  ],
  FUNCIONARIO: [
    'attendance:write',
  ],
};

export function userCan(user: User | null, scope: AppScope) {
  return ROLE_SCOPES[roleForUser(user)].includes(scope);
}
