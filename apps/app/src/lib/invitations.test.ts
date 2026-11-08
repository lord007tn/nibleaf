// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  afterAuthDestination,
  clearPendingDestination,
  readPendingDestination,
  readPendingInvitation,
  safeAppPath,
  setPendingDestination,
  setPendingInvitation,
} from './invitations';

describe('the page to return to after signing in', () => {
  afterEach(() => window.localStorage.clear());

  it('only ever returns to an in-app path, never another site', () => {
    expect(safeAppPath('/accept-invite/inv-1')).toBe('/accept-invite/inv-1');
    for (const unsafe of ['//evil.example/x', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '/a b', '', null]) {
      expect(safeAppPath(unsafe)).toBeNull();
    }
    setPendingDestination('//evil.example/phish');
    expect(readPendingDestination()).toBeNull();
  });

  it('prefers the invitation in the URL, then the remembered page', () => {
    setPendingInvitation('remembered');
    expect(afterAuthDestination({ invite: 'from-url' })).toBe('/accept-invite/from-url');
    expect(afterAuthDestination({})).toBe('/accept-invite/remembered');
    clearPendingDestination();
    expect(afterAuthDestination({})).toBeNull();
  });

  it('still honours an invitation remembered by the previous release', () => {
    window.localStorage.setItem('nibleaf.pendingInvitation', 'legacy-invite');
    expect(readPendingInvitation()).toBe('legacy-invite');
    expect(afterAuthDestination(undefined)).toBe('/accept-invite/legacy-invite');
    clearPendingDestination();
    expect(window.localStorage.getItem('nibleaf.pendingInvitation')).toBeNull();
  });
});
