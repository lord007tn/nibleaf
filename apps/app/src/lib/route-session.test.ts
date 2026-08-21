import { describe, expect, it } from 'vitest';
import { isRouteSession as isAdminRouteSession } from '../../../admin/src/lib/route-session';
import { isRouteSession as isAppRouteSession, resolveRouteSession, shouldShowInitialSessionLoader } from './route-session';

const routeSessionValidators = [isAppRouteSession, isAdminRouteSession];

describe('route session stability', () => {
  it('keeps the route session while the client hook revalidates', () => {
    const initial = { user: { id: 'user-1' } };
    const resolved = resolveRouteSession(null, initial, true);

    expect(resolved).toBe(initial);
    expect(shouldShowInitialSessionLoader(true, resolved)).toBe(false);
  });

  it('only shows the loader before any session has resolved', () => {
    expect(shouldShowInitialSessionLoader(true, null)).toBe(true);
    expect(shouldShowInitialSessionLoader(false, null)).toBe(false);
  });

  it('does not retain a route session after client revalidation signs out', () => {
    const initial = { user: { id: 'user-1' } };
    expect(resolveRouteSession(null, initial, false)).toBeNull();
  });

  it.each([
    null,
    [],
    {},
    { error: 'upstream failed' },
    { session: null, user: null },
    { session: { id: 'session-1', userId: 'user-1' }, user: null },
    { session: { id: 'session-1', userId: 'user-1' }, user: { id: 'other-user' } },
  ])('rejects malformed customer and admin session payloads: %j', (payload) => {
    for (const validate of routeSessionValidators) expect(validate(payload)).toBe(false);
  });

  it('accepts matching non-empty session and user identities in both apps', () => {
    const payload = { session: { id: 'session-1', userId: 'user-1' }, user: { id: 'user-1' } };
    for (const validate of routeSessionValidators) expect(validate(payload)).toBe(true);
  });
});
