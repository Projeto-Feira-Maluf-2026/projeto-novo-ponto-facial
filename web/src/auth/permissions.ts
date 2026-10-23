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
  const metadataRole = user?.app_metadata?.role ?? user?.user_metadata?.role;
  const normalizedRole = String(metadataRole || 'FUNCIONARIO').toUpperCase() as AppRole;
  return validRoles.has(normalizedRole) ? normalizedRole : 'FUNCIONARIO';
}

export function userHasRole(user: User | null, roles: AppRole[]) {
  return roles.includes(roleForUser(user));
}
