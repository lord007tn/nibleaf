import { describe, expect, it } from 'vitest';
import { resolveRouteSession, shouldShowInitialSessionLoader } from './route-session';

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
});
