import { type MessageKey, type MessageVariables, translateFn } from '@nibleaf/i18n';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiResponseError, mutateData } from './client-helpers';
import { friendlyErrorMessage } from './errors';

const t = (key: string) => `t:${key}`;

describe('friendlyErrorMessage', () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  afterEach(() => consoleError.mockClear());

  it('never shows the raw server message', () => {
    const error = new ApiResponseError('A page can only be moved under a parent in the same branch and language.', 400);
    expect(friendlyErrorMessage(t, error, 'editor.reorderFailed')).toBe('t:editor.reorderFailed');
    // The details stay available for debugging.
    expect(consoleError).toHaveBeenCalledWith(error);
  });

  it('explains common HTTP failures in plain words', () => {
    expect(friendlyErrorMessage(t, new ApiResponseError('Forbidden', 403), 'editor.deleteFailed')).toBe('t:error.noPermission');
    expect(friendlyErrorMessage(t, new ApiResponseError('Unauthorized', 401), 'editor.deleteFailed')).toBe('t:error.signedOut');
    expect(friendlyErrorMessage(t, new ApiResponseError('Not found', 404), 'editor.deleteFailed')).toBe('t:error.notFound');
    expect(friendlyErrorMessage(t, new ApiResponseError('Upload failed.', 413), 'editor.deleteFailed')).toBe('t:error.tooLarge');
    expect(friendlyErrorMessage(t, new ApiResponseError('Slow down', 429), 'editor.deleteFailed')).toBe('t:error.rateLimited');
  });

  it.each([
    [
      'branch:main_changed',
      { reason: 'main_changed', changedOnMainSinceFork: [] },
      'en',
      "Main has changed since this version's pages were copied from it, so the version wasn't promoted. Bring those changes into this version, or undo them on main, then promote again.",
    ],
    [
      'branch:main_changed',
      { reason: 'main_changed', changedOnMainSinceFork: [] },
      'ar',
      'تغيّر main منذ نسخ صفحات هذا الإصدار منه، لذلك لم تتم ترقية الإصدار. أدخِل تلك التغييرات في هذا الإصدار، أو تراجع عنها في main، ثم أعد محاولة الترقية.',
    ],
    [
      'branch:baseline_missing',
      { since: '2026-10-01T00:00:00.000Z', mainPagesEditedOrCreatedSince: 2 },
      'en',
      'This version was created before Nibleaf could check main for changes, or copied from a version that was. Create a new version from main and move your changes there.',
    ],
    [
      'branch:baseline_missing',
      { since: '2026-10-01T00:00:00.000Z', mainPagesEditedOrCreatedSince: 2 },
      'ar',
      'أُنشئ هذا الإصدار قبل أن يتمكن Nibleaf من التحقق من تغييرات main، أو نُسخ من إصدار أُنشئ كذلك. أنشئ إصدارًا جديدًا من main وانقل تغييراتك إليه.',
    ],
  ] as const)('gives the promote refusal %s its own complete %s text, not "refresh and try again"', async (code, details, locale, expected) => {
    const localized = (key: MessageKey, variables?: MessageVariables) => translateFn(key, variables, locale);
    // The 409 exactly as the server sends it, through the mutation helper the promote hook uses.
    const response = Response.json({ error: { code, message: 'Not promoted.', details } }, { status: 409 });
    const refused = await mutateData(response, 'Could not merge the branch.').catch((error: unknown) => error);
    expect(refused).toMatchObject({ code, details });
    // The editor's existing, generic call (branch-switcher's promote onError).
    expect(friendlyErrorMessage(localized, refused, 'editor.branch.mergeError')).toBe(expected);
    // Any other 409 keeps the concurrent-edit wording.
    expect(friendlyErrorMessage(localized, new ApiResponseError('Conflict', 409, 'database:conflict'), 'editor.branch.mergeError')).toBe(
      translateFn('error.conflict', undefined, locale),
    );
  });

  it('exposes details.reason from the server', () => {
    const error = new ApiResponseError('Conflict', 409, 'database:conflict', undefined, undefined, undefined, undefined, { reason: 'x' });
    expect(error.reason).toBe('x');
    expect(
      new ApiResponseError('Conflict', 409, 'database:conflict', undefined, undefined, undefined, undefined, { reason: 1 }).reason,
    ).toBeUndefined();
  });

  it('recognises a request that never reached the server', () => {
    expect(friendlyErrorMessage(t, new TypeError('fetch failed'), 'editor.createFailed')).toBe('t:error.network');
  });

  it("lets an action say what a status means for it, so an invite's 409 isn't called a concurrent edit", () => {
    const conflict = new ApiResponseError('That person is already a member of this workspace.', 409);
    expect(friendlyErrorMessage(t, conflict, 'members.toast.inviteError', { 409: 'members.toast.alreadyMember' })).toBe(
      't:members.toast.alreadyMember',
    );
    expect(friendlyErrorMessage(t, conflict, 'members.toast.inviteError')).toBe('t:error.conflict');
    // Other statuses keep the shared wording.
    expect(friendlyErrorMessage(t, new ApiResponseError('Forbidden', 403), 'members.toast.inviteError', { 409: 'members.toast.alreadyMember' })).toBe(
      't:error.noPermission',
    );
  });

  it('falls back to the action message for anything else', () => {
    expect(friendlyErrorMessage(t, new Error('boom'), 'editor.createFailed')).toBe('t:editor.createFailed');
    expect(friendlyErrorMessage(t, 'weird', 'editor.createFailed')).toBe('t:editor.createFailed');
  });
});
