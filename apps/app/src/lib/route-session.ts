import { createIsomorphicFn } from '@tanstack/react-start';
import { getRequest } from '@tanstack/react-start/server';

export type RouteSession = {
  session?: { id?: string | null; userId?: string | null };
  user?: { email?: string | null; id?: string | null; name?: string | null; role?: string | null };
} | null;

export function isRouteSession(value: unknown): value is Exclude<RouteSession, null> {
  if (!(value && typeof value === 'object') || Array.isArray(value)) return false;
  const candidate = value as Exclude<RouteSession, null>;
  const sessionId = candidate.session?.id;
  const sessionUserId = candidate.session?.userId;
  const userId = candidate.user?.id;
  return (
    typeof sessionId === 'string' &&
    sessionId.trim().length > 0 &&
    typeof sessionUserId === 'string' &&
    sessionUserId.trim().length > 0 &&
    typeof userId === 'string' &&
    userId === sessionUserId
  );
}

export const resolveRouteSession = <TClient, TInitial>(
  clientSession: TClient | null | undefined,
  initialSession: TInitial | null,
  isPending: boolean,
): TClient | TInitial | null => clientSession ?? (isPending ? initialSession : null);

export const shouldShowInitialSessionLoader = (isPending: boolean, resolvedSession: unknown): boolean => isPending && !resolvedSession;

const getRouteRequest = createIsomorphicFn()
  .server(() => getRequest())
  .client(() => null);

/** Resolve the current session before a route mounts so background session
 * refreshes never have to tear down an already-rendered auth or app screen. */
export async function getRouteSession(): Promise<RouteSession> {
  const request = import.meta.env.SSR ? getRouteRequest() : null;
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), 5_000);

  try {
    const response = await fetch(request ? new URL('/api/auth/get-session', request.url) : '/api/auth/get-session', {
      credentials: 'include',
      headers: request ? { cookie: request.headers.get('cookie') ?? '' } : undefined,
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const session = (await response.json().catch(() => null)) as unknown;
    return isRouteSession(session) ? session : null;
  } catch {
    return null;
  } finally {
    clearTimeout(abortTimer);
  }
}
