import { authClient } from '@/lib/auth-client';

export interface ActiveWorkspace {
  id: string;
  name: string;
  slug: string;
}

/**
 * The active workspace (organization) for display. better-auth only populates
 * `useActiveOrganization` after an explicit setActive, so fall back to the first
 * workspace — mirroring the server, which scopes to the first membership.
 */
export function useActiveWorkspace(): ActiveWorkspace | null {
  const { data: orgs } = authClient.useListOrganizations();
  const { data: active } = authClient.useActiveOrganization();
  const ws = active ?? (orgs ?? [])[0] ?? null;
  return ws ? { id: ws.id, name: ws.name, slug: ws.slug ?? '' } : null;
}

