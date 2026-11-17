// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  afterAuthDestination,
  clearPendingDestination,
  copyToClipboard,
  readPendingDestination,
  readPendingInvitation,
  safeAppPath,
  safeReturnPath,
  setPendingDestination,
  setPendingInvitation,
  signInReturnSearch,
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

describe('returning to the dashboard page that asked for sign-in', () => {
  afterEach(() => window.localStorage.clear());

  it('keeps a shared conversation link with its filters, and a nested settings link', () => {
    const conversation = '/app/projects/p1/ai?conversation=c9&language=ar&range=30d';
    expect(signInReturnSearch(conversation)).toEqual({ next: conversation });
    expect(afterAuthDestination({ next: conversation })).toBe(conversation);
    const settings = '/app/projects/p1/settings?section=members';
    expect(afterAuthDestination({ next: settings })).toBe(settings);
  });

  it('needs no return path for the dashboard home', () => {
    expect(signInReturnSearch('/app')).toEqual({});
    expect(signInReturnSearch('/app/')).toEqual({});
  });

  it('drops external, malformed and non-dashboard destinations', () => {
    for (const unsafe of [
      'https://evil.example/app',
      '//evil.example/app',
      '/evil.example',
      '/application',
      '/sign-in',
      '/app x',
      'javascript:alert(1)',
      42,
    ]) {
      expect(safeReturnPath(unsafe)).toBeNull();
      expect(afterAuthDestination({ next: unsafe as string })).toBeNull();
    }
  });

  it('keeps an invitation in the URL ahead of the return path, and the return path ahead of a remembered page', () => {
    setPendingInvitation('remembered');
    expect(afterAuthDestination({ invite: 'from-url', next: '/app/projects/p1' })).toBe('/accept-invite/from-url');
    expect(afterAuthDestination({ next: '/app/projects/p1' })).toBe('/app/projects/p1');
    expect(afterAuthDestination({ next: '//evil.example' })).toBe('/accept-invite/remembered');
  });
});

describe('copyToClipboard', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: undefined });
  });

  it('uses the Clipboard API when it is there', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    expect(await copyToClipboard('https://docs.example.com/start')).toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://docs.example.com/start');
  });

  it('falls back to copying a selected field when the API is missing or refused, and gives focus back', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) },
    });
    let copied = '';
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: vi.fn(() => {
        copied = (document.activeElement as HTMLTextAreaElement).value;
        return true;
      }),
    });
    const button = document.createElement('button');
    document.body.append(button);
    button.focus();
    expect(await copyToClipboard('https://docs.example.com/start')).toBe(true);
    expect(copied).toBe('https://docs.example.com/start');
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it('reports failure when neither way can copy', async () => {
    expect(await copyToClipboard('x')).toBe(false);
  });
});
