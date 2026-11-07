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
      'en',
      "Pages on main changed after this version was created, so it wasn't promoted. Soon you'll be able to review those pages and confirm. Until then, your version stays as it is.",
    ],
    [
      'ar',
      'تغيّرت صفحات في main بعد إنشاء هذا الإصدار، لذلك لم تتم ترقيته. ستتمكن قريبًا من مراجعة هذه الصفحات وتأكيد الترقية. حتى ذلك الحين، يبقى إصدارك كما هو.',
    ],
  ] as const)('gives the editor’s promote error its own %s text for branch:main_changed, not "refresh and try again"', async (locale, expected) => {
    const localized = (key: MessageKey, variables?: MessageVariables) => translateFn(key, variables, locale);
    // The 409 exactly as the server sends it, through the mutation helper the promote hook uses.
    const response = Response.json(
      {
        error: {
          code: 'branch:main_changed',
          message: 'Pages on main changed since this version was created.',
          details: { changedOnMainSinceFork: [] },
        },
      },
      { status: 409 },
    );
    const blocked = await mutateData(response, 'Could not merge the branch.').catch((error: unknown) => error);
    // The editor's existing, generic call (branch-switcher's promote onError).
    expect(friendlyErrorMessage(localized, blocked, 'editor.branch.mergeError')).toBe(expected);
    // Any other 409 keeps the concurrent-edit wording.
    expect(friendlyErrorMessage(localized, new ApiResponseError('Conflict', 409, 'database:conflict'), 'editor.branch.mergeError')).toBe(
      translateFn('error.conflict', undefined, locale),
    );
  });

  it.each([
    ['en', 'Someone saved during the promote. Nothing changed; try again.'],
    ['ar', 'حفظ أحدهم تغييرات أثناء الترقية. لم يتغيّر شيء؛ حاول مجددًا.'],
  ] as const)('tells the writer to retry, in %s, when a save raced the promote (details.reason)', async (locale, expected) => {
    const localized = (key: MessageKey, variables?: MessageVariables) => translateFn(key, variables, locale);
    const response = Response.json(
      { error: { code: 'database:conflict', message: 'Pages changed while promoting.', details: { reason: 'promote_raced' } } },
      { status: 409 },
    );
    const raced = await mutateData(response, 'Could not merge the branch.').catch((error: unknown) => error);
    expect(friendlyErrorMessage(localized, raced, 'editor.branch.mergeError')).toBe(expected);
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
