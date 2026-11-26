// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ compact: false, openSwitcher: vi.fn(), close: vi.fn() }));

vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, vars?: Record<string, string>) => (vars ? `${key}(${Object.values(vars).join('|')})` : key),
}));
vi.mock('./use-compact-switcher', () => ({ useCompactSwitcher: () => mocks.compact }));
vi.mock('./switcher-panel', () => ({ SwitcherPanel: () => null }));
vi.mock('./switcher-context', () => ({
  useSwitcherControls: () => ({
    open: null,
    openSwitcher: mocks.openSwitcher,
    close: mocks.close,
    registerTrigger: () => () => undefined,
    current: {},
  }),
}));

import { OrganizationSwitcher } from './organization-switcher';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot> | undefined;
const name = 'Acme Docs — مساحة توثيق ليلى 2026';

beforeEach(() => {
  mocks.openSwitcher.mockClear();
});
afterEach(() => {
  act(() => root?.unmount());
  document.body.innerHTML = '';
});

const render = () => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<OrganizationSwitcher organization={{ id: 'org-1', name, logo: null }} />));
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
  if (!trigger) throw new Error('No trigger');
  return trigger;
};

it.each([
  ['popover', false],
  ['sheet', true],
])('the %s trigger preserves the full organization name in its label', (_, compact) => {
  mocks.compact = compact;
  const trigger = render();
  // The shared Button defaults to no shrinking, which let long org names overflow the header.
  expect(trigger.classList).not.toContain('shrink-0');
  expect(trigger.getAttribute('aria-label')).toBe(`switcher.organizationTrigger(${name})`);
  const label = trigger.querySelector('[dir="auto"]');
  expect(label?.textContent).toBe(name);
  expect(label?.getAttribute('dir')).toBe('auto');
  expect(trigger.querySelectorAll('bdi, [dir]')).toHaveLength(1);
});

it('the phone trigger still opens the organization switcher', () => {
  mocks.compact = true;
  const trigger = render();
  act(() => trigger.click());
  expect(mocks.openSwitcher).toHaveBeenCalledWith('organization');
});
