import { canAdminister } from '@nibleaf/shared/rbac';

export function resolveProjectSettingsAccess(role: string | undefined, pending: boolean): 'pending' | 'admin' | 'notAdmin' {
  if (pending) return 'pending';
  return canAdminister(role ?? '') ? 'admin' : 'notAdmin';
}
