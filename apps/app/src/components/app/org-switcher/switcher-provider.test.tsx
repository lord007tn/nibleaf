// @vitest-environment jsdom
import { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  params: {} as { orgSlug?: string; projectId?: string },
  panel: vi.fn(),
  createDialog: vi.fn(),
}));

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (state: { matches: Array<{ params: unknown }> }) => unknown }) =>
    select({ matches: [{ params: {} }, { params: mocks.params }] }),
}));
vi.mock('@/hooks/api', () => ({
  useOrganizationBySlug: (slug?: string) => ({ data: slug === 'acme' ? { id: 'org-acme' } : undefined }),
  useProject: (id?: string) => ({ data: id ? { id, organizationId: 'org-of-project' } : undefined }),
  useSwitcher: () => ({ data: { organizations: [{ id: 'org-jood', slug: 'jood' }] } }),
}));
vi.mock('./switcher-panel', () => ({
  SwitcherPanel: (props: { currentOrganizationId?: string; currentProjectId?: string; initialPane?: string; onClose: () => void }) => {
    mocks.panel(props);
    return (
      <div data-pane={props.initialPane} data-testid="switcher-panel">
        <button onClick={props.onClose} type="button">
          close panel
        </button>
      </div>
    );
  },
}));
vi.mock('./create-organization-dialog', () => ({
  CreateOrganizationDialog: ({ open }: { open: boolean }) => {
    mocks.createDialog(open);
    return open ? <div data-testid="create-organization" /> : null;
  },
}));

import { type SwitcherControls, type SwitcherKind, useSwitcherControls } from './switcher-context';
import { SwitcherProvider } from './switcher-provider';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;
let controls: SwitcherControls | null = null;

function Probe({ triggers = [] }: { triggers?: SwitcherKind[] }) {
  const current = useSwitcherControls();
  controls = current;
  const register = current?.registerTrigger;
  useEffect(() => {
    const cleanups = triggers.map((kind) => register?.(kind));
    return () => {
      for (const cleanup of cleanups) cleanup?.();
    };
  }, [register, triggers]);
  return (
    <div>
      <span data-testid="open">{current?.open ? `${current.open.kind}:${current.open.pane}` : 'closed'}</span>
      <input aria-label="field" />
      <span data-testid="current">{JSON.stringify(current?.current)}</span>
    </div>
  );
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  mocks.params = {};
  controls = null;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

const noTriggers: SwitcherKind[] = [];
async function render(triggers: SwitcherKind[] = noTriggers) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <SwitcherProvider>
        <Probe triggers={triggers} />
      </SwitcherProvider>,
    ),
  );
  return host;
}
const press = (name: string, target: EventTarget = document.body) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  });
const state = () => document.querySelector('[data-testid="open"]')?.textContent;
const panel = () => document.querySelector<HTMLElement>('[data-testid="switcher-panel"]');

const bothTriggers: SwitcherKind[] = ['organization', 'website'];
const orgTrigger: SwitcherKind[] = ['organization'];

describe('switcher provider', () => {
  it('G then O opens the organization switcher', async () => {
    await render(bothTriggers);
    await press('g');
    await press('o');
    expect(state()).toBe('organization:orgs');
    // The header trigger is mounted, so no fallback dialog.
    expect(panel()).toBeNull();
  });

  it('G then W opens the website switcher when a website trigger is registered', async () => {
    await render(bothTriggers);
    await press('g');
    await press('w');
    expect(state()).toBe('website:orgs');
  });

  it('G then W opens the org switcher on its websites pane without a website trigger', async () => {
    await render(orgTrigger);
    await press('g');
    await press('w');
    expect(state()).toBe('organization:websites');
  });

  it('ignores the sequence typed in an input', async () => {
    await render(bothTriggers);
    const input = document.querySelector('input') as HTMLInputElement;
    await press('g', input);
    await press('o', input);
    expect(state()).toBe('closed');
    // A stray key between G and O breaks the sequence.
    await press('g');
    await press('x');
    await press('o');
    expect(state()).toBe('closed');
  });

  it('falls back to a dialog with the switcher panel when no org trigger is registered', async () => {
    mocks.params = { orgSlug: 'acme' };
    await render();
    expect(panel()).toBeNull();
    await press('g');
    await press('w');
    expect(state()).toBe('organization:websites');
    expect(panel()?.dataset.pane).toBe('websites');
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('switcher.dialogLabel');
    expect(mocks.panel).toHaveBeenLastCalledWith(expect.objectContaining({ currentOrganizationId: 'org-acme', initialPane: 'websites' }));
    await act(async () => (document.querySelector('[data-testid="switcher-panel"] button') as HTMLButtonElement).click());
    expect(state()).toBe('closed');
    expect(panel()).toBeNull();
  });

  it('resolves the current scope from the URL: org slug, project, or the switcher list', async () => {
    mocks.params = { projectId: 'p-1' };
    await render(bothTriggers);
    expect(controls?.current).toEqual({ organizationId: 'org-of-project', projectId: 'p-1' });
    await act(async () => root.unmount());
    mocks.params = { orgSlug: 'jood' };
    await render(bothTriggers);
    expect(controls?.current).toEqual({ organizationId: 'org-jood', projectId: undefined });
  });

  it('openCreateOrganization closes the switcher and opens the create dialog', async () => {
    await render(bothTriggers);
    await act(async () => controls?.openSwitcher('organization'));
    expect(state()).toBe('organization:orgs');
    await act(async () => controls?.openCreateOrganization());
    expect(state()).toBe('closed');
    expect(document.querySelector('[data-testid="create-organization"]')).not.toBeNull();
  });
});
