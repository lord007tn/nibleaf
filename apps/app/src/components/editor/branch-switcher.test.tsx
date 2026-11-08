/** @vitest-environment jsdom */

import { type Locale, type MessageKey, type MessageVariables, translateFn } from '@nibleaf/i18n';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Branch, BranchMergePreview } from '@/hooks/api';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import type { PromoteChange } from './promote-review';

const mocks = vi.hoisted(() => ({
  locale: 'en' as Locale,
  merge: vi.fn(),
  create: vi.fn(),
  fetchPreview: vi.fn(),
  confirm: vi.fn(async () => true),
}));

const translate = (key: MessageKey, variables?: MessageVariables) => translateFn(key, variables, mocks.locale);
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => translate,
  useLocale: () => ({ locale: mocks.locale, t: translate, setLocale: vi.fn() }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ fetchQuery: mocks.fetchPreview }),
}));
vi.mock('@/hooks/api', async () => ({
  friendlyErrorMessage: (await import('@/hooks/api/errors')).friendlyErrorMessage,
  branchMergePreviewQueryOptions: (projectId: string, branchId: string) => ({ queryKey: ['merge-preview', projectId, branchId] }),
  useCreateBranch: () => ({ mutate: mocks.create, isPending: false }),
  useMergeBranch: () => ({ mutate: mocks.merge, isPending: false }),
}));

import { BranchSwitcher } from './branch-switcher';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const branch = (id: string, name: string, isDefault: boolean): Branch => ({
  id,
  projectId: 'project-1',
  name,
  isDefault,
  forkedAt: isDefault ? null : '2026-11-01T00:00:00.000Z',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
});
const branches = [branch('main-id', 'main', true), branch('v2-id', 'v2', false)];
const FINGERPRINT = 'a'.repeat(64);
const entry = (overrides: Partial<PromoteChange>): PromoteChange => ({
  pageId: 'page-1',
  title: 'Refunds',
  path: 'guide/refunds',
  languageCode: 'en',
  change: 'modified',
  onPromote: 'kept',
  updatedAt: '2026-11-05T00:00:00.000Z',
  ...overrides,
});
const preview = (entries: PromoteChange[], baselineComplete = true): BranchMergePreview => ({
  changedOnMainSinceFork: entries,
  baselineComplete,
  fingerprint: FINGERPRINT,
});
const refusal = (code: string, details?: Record<string, unknown>) =>
  new ApiResponseError('Refused', 409, code, undefined, undefined, undefined, undefined, details);
const roots: Array<ReturnType<typeof createRoot>> = [];

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
});

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mocks.locale = 'en';
  mocks.confirm.mockImplementation(async () => true);
});

/** Choose "Promote into main" for `v2` in the version menu, with main's changes in `loaded`. */
async function promote(loaded: BranchMergePreview) {
  mocks.fetchPreview.mockResolvedValue(loaded);
  const onSwitch = vi.fn();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<BranchSwitcher projectId="project-1" branches={branches} activeBranchId="v2-id" onSwitch={onSwitch} />));
  const trigger = container.querySelector('button');
  if (!trigger) throw new Error('No version menu trigger');
  await act(async () => trigger.click());
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (candidate) => candidate.textContent?.trim() === translate('editor.branch.merge'),
  );
  if (!item) throw new Error('No Promote item in the version menu');
  await act(async () => item.click());
  expect(mocks.fetchPreview).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['merge-preview', 'project-1', 'v2-id'], staleTime: 0 }));
  return onSwitch;
}

const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]');
const section = (group: string) => document.querySelector<HTMLElement>(`[data-promote-group="${group}"]`);
const dialogButton = (key: MessageKey) =>
  [...(dialog()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((button) => button.textContent?.trim() === translate(key));
const toastAction = (call = 0) =>
  (vi.mocked(toast.error).mock.calls[call]?.[1] as { action?: { label: string; onClick: () => void } } | undefined)?.action;

describe('BranchSwitcher promote review', () => {
  it.each<[string, PromoteChange[], string[]]>([
    [
      'lost',
      [
        entry({ onPromote: 'replaced', replacedFields: ['title', 'content'] }),
        entry({ pageId: 'page-2', title: 'Old FAQ', onPromote: 'removed' }),
        entry({ pageId: 'page-3', title: 'Pricing', change: 'added', onPromote: 'removed' }),
      ],
      ["Main's edits are lost for: Title and Content.", "Deleted in this version, so it's removed from main with its comments."],
    ],
    [
      'moves',
      [
        entry({ change: 'conflict', onPromote: 'renamed', newPath: 'guide/refunds-2' }),
        entry({ pageId: 'page-2', change: 'added', onPromote: 'moved', newParentPath: 'billing' }),
        entry({ pageId: 'page-3', onPromote: 'moved', newParentPath: null }),
        entry({ pageId: 'page-4', change: 'deleted', onPromote: 'restored' }),
      ],
      [
        'Another page has this address, so this one becomes guide/refunds-2.',
        'Its folder goes away, so it moves under billing.',
        'Its folder goes away, so it moves to the top level.',
        'Deleted on main, but this version edited it, so it comes back.',
      ],
    ],
    [
      'stays',
      [
        entry({ onPromote: 'merged' }),
        entry({ pageId: 'page-2', change: 'added', onPromote: 'kept' }),
        entry({ pageId: 'page-3', change: 'deleted', onPromote: 'removed' }),
      ],
      ['Edited on both, in different places: both sets of edits are kept.', 'Stays as it is on main.', 'Deleted on main; it stays deleted.'],
    ],
  ])('groups %s pages, says what happens to each, and confirms exactly that list', async (group, entries, outcomes) => {
    const onSwitch = await promote(preview(entries));
    expect(mocks.confirm).not.toHaveBeenCalled();
    const list = section(group);
    expect(list?.querySelectorAll('li')).toHaveLength(entries.length);
    for (const outcome of outcomes) expect(list?.textContent).toContain(outcome);
    // Only this group is shown.
    expect(document.querySelectorAll('[data-promote-group]')).toHaveLength(1);
    expect(mocks.merge).not.toHaveBeenCalled();
    mocks.merge.mockImplementation((_input: unknown, options: { onSuccess: () => void }) => options.onSuccess());
    await act(async () => dialogButton('editor.branch.merge')?.click());
    expect(mocks.merge).toHaveBeenCalledWith({ id: 'v2-id', confirmPreview: FINGERPRINT }, expect.anything());
    expect(onSwitch).toHaveBeenCalledWith('main-id');
    expect(dialog()).toBeNull();
  });

  it('shows pages that block the promote, with no way to confirm', async () => {
    await promote(
      preview([entry({ change: 'conflict', onPromote: 'blocked' }), entry({ pageId: 'page-2', onPromote: 'replaced', replacedFields: ['slug'] })]),
    );
    expect(section('blocked')?.textContent).toContain(translate('editor.promote.blocked'));
    expect(dialog()?.textContent).toContain(translate('error.promoteBlocked'));
    // Blocked pages come first.
    expect([...document.querySelectorAll('[data-promote-group]')].map((element) => element.getAttribute('data-promote-group'))).toEqual([
      'blocked',
      'lost',
    ]);
    expect(dialogButton('editor.branch.merge')).toBeUndefined();
    expect(dialogButton('deploy.close')).toBeDefined();
  });

  it('reviews in Arabic, page addresses kept left to right', async () => {
    mocks.locale = 'ar';
    await promote(preview([entry({ onPromote: 'replaced', replacedFields: ['title'] })]));
    expect(dialog()?.textContent).toContain(translateFn('editor.promote.group.lost', undefined, 'ar'));
    expect(section('lost')?.textContent).toContain(
      translateFn('editor.promote.replaced', { fields: translateFn('editor.pageSettings.pageTitle', undefined, 'ar') }, 'ar'),
    );
    expect(section('lost')?.querySelector('[dir="ltr"]')?.textContent).toBe('en');
  });

  it('asks only the usual question when every page main changed stays as it is', async () => {
    await promote(preview([entry({ onPromote: 'kept' }), entry({ pageId: 'page-2', change: 'added', onPromote: 'kept' })]));
    expect(dialog()).toBeNull();
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.merge).toHaveBeenCalledWith({ id: 'v2-id', confirmPreview: FINGERPRINT }, expect.anything());
  });

  it('promotes without a fingerprint when main has not changed', async () => {
    await promote(preview([]));
    expect(dialog()).toBeNull();
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.merge).toHaveBeenCalledWith('v2-id', expect.anything());
  });

  it('does nothing when the usual question is cancelled', async () => {
    mocks.confirm.mockImplementation(async () => false);
    await promote(preview([]));
    expect(mocks.merge).not.toHaveBeenCalled();
  });

  it('shows the fresh list when main changes again before the promote lands', async () => {
    await promote(preview([entry({ onPromote: 'merged' })]));
    const fresh = preview([entry({ pageId: 'page-9', title: 'Shipping', onPromote: 'replaced', replacedFields: ['content'] })]);
    mocks.merge.mockImplementation((_input: unknown, options: { onError: (error: unknown) => void }) =>
      options.onError(refusal('branch:main_changed', { reason: 'main_changed', ...fresh })),
    );
    await act(async () => dialogButton('editor.branch.merge')?.click());
    expect(section('lost')?.textContent).toContain('Shipping');
    expect(section('stays')).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('says a save raced the promote and loads the list again', async () => {
    await promote(preview([entry({ onPromote: 'merged' })]));
    mocks.merge.mockImplementation((_input: unknown, options: { onError: (error: unknown) => void }) =>
      options.onError(refusal('database:conflict', { reason: 'promote_raced' })),
    );
    await act(async () => dialogButton('editor.branch.merge')?.click());
    expect(toast.error).toHaveBeenCalledWith(translate('error.promoteRaced'));
    expect(mocks.fetchPreview).toHaveBeenCalledTimes(2);
    expect(section('stays')).not.toBeNull();
  });
});

describe('BranchSwitcher promote refusals', () => {
  it.each(['en', 'ar'] as const)('%s: a version with no fork baseline explains why, with one "Switch to main" action', async (locale) => {
    mocks.locale = locale;
    const onSwitch = await promote(preview([], false));
    expect(mocks.merge).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(translate('error.branchBaselineMissing'));
    const action = toastAction();
    expect(action?.label).toBe(translate('editor.branch.switchToMain'));
    // Nothing happens until the writer asks: no switch, and never a new version.
    expect(onSwitch).not.toHaveBeenCalled();
    action?.onClick();
    expect(onSwitch).toHaveBeenCalledWith('main-id');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('explains a baseline_missing refusal from the promote itself, with "Switch to main"', async () => {
    mocks.merge.mockImplementation((_input: unknown, options: { onError: (error: unknown) => void }) =>
      options.onError(refusal('branch:baseline_missing', { since: '2026-11-01T00:00:00.000Z', mainPagesEditedOrCreatedSince: 2 })),
    );
    const onSwitch = await promote(preview([]));
    expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toBe(translate('error.branchBaselineMissing'));
    toastAction()?.onClick();
    expect(onSwitch).toHaveBeenCalledWith('main-id');
  });

  it('offers no action for other promote failures', async () => {
    mocks.merge.mockImplementation((_input: unknown, options: { onError: (error: unknown) => void }) =>
      options.onError(new ApiResponseError('Conflict', 409, 'database:conflict')),
    );
    const onSwitch = await promote(preview([]));
    expect(toast.error).toHaveBeenCalledWith(translate('error.conflict'));
    expect(vi.mocked(toast.error).mock.calls[0]).toHaveLength(1);
    expect(onSwitch).not.toHaveBeenCalled();
  });
});
