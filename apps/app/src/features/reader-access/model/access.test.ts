import { describe, expect, it } from 'vitest';
import {
  ACCESS_MODES,
  accessView,
  decisionProps,
  isExposingChange,
  manageDecision,
  modeDecision,
  showsRequestList,
  visibilityChangeCopy,
} from './access';

describe('visibility choices', () => {
  it('offers Public, Team only and Invited readers, in that order', () => {
    expect(ACCESS_MODES.map((option) => option.mode)).toEqual(['PUBLIC', 'WORKSPACE', 'READERS']);
  });

  it('explains each change of visibility in its own words', () => {
    expect(visibilityChangeCopy('PUBLIC', 'READERS').title).toBe('settings.visibility.confirmPrivateTitle');
    expect(visibilityChangeCopy('PUBLIC', 'WORKSPACE').title).toBe('settings.visibility.confirmPrivateTitle');
    expect(visibilityChangeCopy('READERS', 'PUBLIC').title).toBe('settings.visibility.confirmPublicTitle');
    expect(visibilityChangeCopy('WORKSPACE', 'PUBLIC')).toEqual({
      title: 'settings.visibility.confirmPublicTitle',
      description: 'settings.visibility.confirmPublicBody',
    });
    expect(visibilityChangeCopy('READERS', 'WORKSPACE').title).toBe('settings.visibility.confirmToTeamTitle');
    expect(visibilityChangeCopy('WORKSPACE', 'READERS').title).toBe('settings.visibility.confirmToReadersTitle');
  });

  it('treats only opening the site to everyone as the exposing change', () => {
    expect(isExposingChange('PUBLIC')).toBe(true);
    expect(isExposingChange('WORKSPACE')).toBe(false);
    expect(isExposingChange('READERS')).toBe(false);
  });
});

describe('access', () => {
  it('lets Admins manage, locks while access is unknown, and explains once to everyone else', () => {
    expect(accessView('admin', 'edit')).toEqual({ kind: 'manage' });
    expect(accessView('pending', 'pending')).toEqual({ kind: 'locked' });
    expect(accessView('notAdmin', 'edit')).toEqual({ kind: 'readOnly', note: 'settings.permissions.body' });
    expect(accessView('notAdmin', 'viewOnly')).toEqual({ kind: 'readOnly', note: 'settings.permissions.viewerBody' });
  });

  it('locks the visibility choice without a reason until access is known, and says why while a change saves', () => {
    expect(modeDecision('pending', false)).toEqual({ kind: 'locked' });
    expect(modeDecision('notAdmin', false)).toEqual({ kind: 'locked' });
    expect(modeDecision('admin', false)).toEqual({ kind: 'allowed' });
    expect(modeDecision('admin', true)).toEqual({ kind: 'denied', reason: 'common.saving' });
  });

  it('locks other writes until access is known, and a control while its own write runs', () => {
    expect(manageDecision('pending')).toEqual({ kind: 'locked' });
    expect(manageDecision('notAdmin', true)).toEqual({ kind: 'locked' });
    expect(manageDecision('admin')).toEqual({ kind: 'allowed' });
    expect(manageDecision('admin', true)).toEqual({ kind: 'denied', reason: 'common.saving' });
  });

  it('turns a decision into disabled and reason props', () => {
    expect(decisionProps({ kind: 'allowed' })).toEqual({ disabled: false });
    expect(decisionProps({ kind: 'locked' })).toEqual({ disabled: true });
    expect(decisionProps({ kind: 'denied', reason: 'common.saving' })).toEqual({ disabled: true, reason: 'common.saving' });
  });
});

describe('access requests', () => {
  it('lists requests while they are on, and keeps waiting ones visible after they are turned off', () => {
    const request = { id: 'q1' };
    expect(showsRequestList({ readerAccessRequests: false, accessRequests: [] })).toBe(false);
    expect(showsRequestList({ readerAccessRequests: true, accessRequests: [] })).toBe(true);
    expect(showsRequestList({ readerAccessRequests: false, accessRequests: [request] })).toBe(true);
  });
});
