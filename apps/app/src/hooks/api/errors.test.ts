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
      "Main has changed since this version's pages were copied from it, so the version wasn't promoted. Bring those changes into this version, or undo them on main, then promote again.",
    ],
    [
      'ar',
      'تغيّر main منذ نسخ صفحات هذا الإصدار منه، لذلك لم تتم ترقية الإصدار. أدخِل تلك التغييرات في هذا الإصدار، أو تراجع عنها في main، ثم أعد محاولة الترقية.',
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

  it.each([
    [
      'en',
      'Promoting would put pages inside each other, so nothing changed. In the version, move one of those pages out of the other, then promote again.',
    ],
    ['ar', 'كانت الترقية ستضع صفحاتٍ داخل بعضها، لذلك لم يتغيّر شيء. في الإصدار، انقل إحدى هذه الصفحات خارج الأخرى، ثم أعد الترقية.'],
  ] as const)('explains, in %s, a promote refused because pages would end up inside each other', async (locale, expected) => {
    const localized = (key: MessageKey, variables?: MessageVariables) => translateFn(key, variables, locale);
    const response = Response.json(
      {
        error: {
          code: 'branch:promote_blocked',
          message: 'Promoting would put pages inside each other.',
          details: { reason: 'cycle', changedOnMainSinceFork: [] },
        },
      },
      { status: 409 },
    );
    const blocked = await mutateData(response, 'Could not merge the branch.').catch((error: unknown) => error);
    expect(friendlyErrorMessage(localized, blocked, 'editor.branch.mergeError')).toBe(expected);
  });

  it.each([
    [
      'en',
      'This version was created before Nibleaf could check main for changes, or copied from a version that was. Create a new version from main and move your changes there.',
    ],
    [
      'ar',
      'أُنشئ هذا الإصدار قبل أن يتمكن Nibleaf من التحقق من تغييرات main، أو نُسخ من إصدار أُنشئ كذلك. أنشئ إصدارًا جديدًا من main وانقل تغييراتك إليه.',
    ],
  ] as const)('explains, in %s, that a version without a baseline cannot be promoted', async (locale, expected) => {
    const localized = (key: MessageKey, variables?: MessageVariables) => translateFn(key, variables, locale);
    const response = Response.json(
      {
        error: {
          code: 'branch:baseline_missing',
          message: 'No baseline.',
          details: { since: '2026-01-01T00:00:00.000Z', mainPagesEditedOrCreatedSince: 2 },
        },
      },
      { status: 409 },
    );
    const refused = await mutateData(response, 'Could not merge the branch.').catch((error: unknown) => error);
    expect(friendlyErrorMessage(localized, refused, 'editor.branch.mergeError')).toBe(expected);
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
