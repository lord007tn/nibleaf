/** @vitest-environment jsdom */

import { type Locale, type MessageKey, type MessageVariables, translateFn } from '@nibleaf/i18n';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Branch } from '@/hooks/api';
import { ApiResponseError } from '@/hooks/api/client-helpers';

const mocks = vi.hoisted(() => ({
  locale: 'en' as Locale,
  merge: vi.fn(),
  create: vi.fn(),
}));

vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: MessageKey, variables?: MessageVariables) => translateFn(key, variables, mocks.locale),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => async () => true }));
vi.mock('@/hooks/api', async () => ({
  friendlyErrorMessage: (await import('@/hooks/api/errors')).friendlyErrorMessage,
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
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
});
const branches = [branch('main-id', 'main', true), branch('v2-id', 'v2', false)];
const roots: Array<ReturnType<typeof createRoot>> = [];

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  mocks.locale = 'en';
});

/** Promote `v2` from the version menu, with the server refusing it with `error`. */
async function promoteRefusedWith(error: unknown) {
  mocks.merge.mockImplementation((_id: string, options: { onError: (error: unknown) => void }) => options.onError(error));
  const onSwitch = vi.fn();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(<BranchSwitcher projectId="project-1" branches={branches} activeBranchId="v2-id" onSwitch={onSwitch} />));
  const trigger = container.querySelector('button');
  if (!trigger) throw new Error('No version menu trigger');
  await act(async () => trigger.click());
  const promote = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (item) => item.textContent?.trim() === translateFn('editor.branch.merge', undefined, mocks.locale),
  );
  if (!promote) throw new Error('No Promote item in the version menu');
  await act(async () => promote.click());
  expect(mocks.merge).toHaveBeenCalledWith('v2-id', expect.anything());
  return onSwitch;
}

describe('BranchSwitcher promote refusals', () => {
  it.each([
    ['en', 'branch:main_changed', 'error.branchMainChanged'],
    ['ar', 'branch:main_changed', 'error.branchMainChanged'],
    ['en', 'branch:baseline_missing', 'error.branchBaselineMissing'],
    ['ar', 'branch:baseline_missing', 'error.branchBaselineMissing'],
  ] as const)('%s: shows the %s explanation with one "Switch to main" action', async (locale, code, messageKey) => {
    mocks.locale = locale;
    const onSwitch = await promoteRefusedWith(
      new ApiResponseError('Refused', 409, code, undefined, undefined, undefined, undefined, { reason: code.slice(7) }),
    );
    expect(toast.error).toHaveBeenCalledTimes(1);
    const [message, options] = vi.mocked(toast.error).mock.calls[0] ?? [];
    expect(message).toBe(translateFn(messageKey, undefined, locale));
    expect(message).not.toBe(messageKey);
    const action = (options as { action?: { label: string; onClick: () => void } } | undefined)?.action;
    expect(action?.label).toBe(translateFn('editor.branch.switchToMain', undefined, locale));
    // Nothing happens until the writer asks: no switch, and never a new version.
    expect(onSwitch).not.toHaveBeenCalled();
    action?.onClick();
    expect(onSwitch).toHaveBeenCalledWith('main-id');
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('offers no action for other promote failures', async () => {
    const onSwitch = await promoteRefusedWith(new ApiResponseError('Conflict', 409, 'database:conflict'));
    expect(toast.error).toHaveBeenCalledWith(translateFn('error.conflict', undefined, 'en'));
    expect(vi.mocked(toast.error).mock.calls[0]).toHaveLength(1);
    expect(onSwitch).not.toHaveBeenCalled();
  });
});
