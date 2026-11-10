// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Site = { id: string; name: string; icon: null; domain: string | null; live: boolean };

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  open: null as { kind: 'organization' | 'website'; pane: 'orgs' | 'websites' } | null,
  openSwitcher: vi.fn(),
  close: vi.fn(),
  registerTrigger: vi.fn(() => () => undefined),
  websites: {} as Record<string, Site[]>,
  pending: false,
  requested: [] as Array<string | undefined>,
}));

vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, vars?: Record<string, string>) => (vars ? `${key}(${Object.values(vars).join('|')})` : key),
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('./use-compact-switcher', () => ({ useCompactSwitcher: () => false }));
vi.mock('./switcher-context', () => ({
  useSwitcherControls: () => ({
    open: mocks.open,
    openSwitcher: mocks.openSwitcher,
    close: mocks.close,
    registerTrigger: mocks.registerTrigger,
    current: {},
  }),
}));
vi.mock('@/hooks/api', () => ({
  useOrganizationSwitcherProjects: (id?: string) => {
    mocks.requested.push(id);
    return mocks.pending ? { isPending: true } : { data: mocks.websites[id ?? ''] ?? [], isPending: false };
  },
}));

import { WebsiteSwitcher } from './website-switcher';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;
const site = (id: string, name: string, live = true): Site => ({ id, name, icon: null, domain: `${id}.nibleaf.app`, live });

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  Element.prototype.scrollIntoView = vi.fn();
  mocks.open = { kind: 'website', pane: 'orgs' };
  mocks.pending = false;
  mocks.requested = [];
  mocks.websites = {
    acme: [site('docs', 'Developer docs'), site('api', 'API reference'), site('hand', 'Handbook', false)],
    jood: [site('pms', 'PMS guide')],
  };
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

async function render(project: { id: string; name: string } | null = { id: 'api', name: 'API reference' }) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<WebsiteSwitcher organization={{ id: 'acme', name: 'Acme Docs' }} project={project ?? undefined} />));
  return host;
}
const listbox = () => document.querySelector<HTMLElement>('[role="listbox"]') as HTMLElement;
const options = () => [...listbox().querySelectorAll<HTMLElement>('[role="option"]')];
const active = () => document.getElementById(listbox().getAttribute('aria-activedescendant') ?? '');
const search = () => document.querySelector<HTMLInputElement>('input[type="search"]') as HTMLInputElement;
const key = (target: Element, name: string) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  });
const type = (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

describe('website switcher', () => {
  it('renders a dialog-popup trigger with the website name and registers itself', async () => {
    mocks.open = null;
    const host = await render();
    const trigger = host.querySelector('button') as HTMLButtonElement;
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.getAttribute('aria-label')).toBe('switcher.websiteTrigger(API reference)');
    expect(trigger.textContent).toContain('API reference');
    expect(mocks.registerTrigger).toHaveBeenCalledWith('website');
    expect(document.querySelector('[role="listbox"]')).toBeNull();
  });

  it('opens through the switcher controls when the trigger is clicked', async () => {
    mocks.open = null;
    const host = await render();
    await act(async () => host.querySelector('button')?.click());
    expect(mocks.openSwitcher).toHaveBeenCalledWith('website');
  });

  it('lists only the given org websites and marks the current one selected and active', async () => {
    await render();
    expect(mocks.requested).toContain('acme');
    expect(mocks.requested).not.toContain('jood');
    expect(listbox().getAttribute('aria-label')).toBe('switcher.websitesIn(Acme Docs)');
    expect(options().map((node) => node.textContent)).toEqual(['Developer docs', 'API reference', 'Handbook']);
    expect(options()[2]?.getAttribute('aria-label')).toBe('switcher.websiteLabel(Handbook|Acme Docs|switcher.status.draft)');
    const selected = options().filter((node) => node.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent).toBe('API reference');
    expect(active()?.textContent).toBe('API reference');
    expect(document.activeElement).toBe(listbox());
  });

  it('moves with ArrowDown and End and opens the active website with Enter', async () => {
    await render({ id: 'docs', name: 'Developer docs' });
    await key(listbox(), 'ArrowDown');
    expect(active()?.textContent).toBe('API reference');
    await key(listbox(), 'Enter');
    expect(mocks.close).toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/projects/$projectId', params: { projectId: 'api' } });
    await key(listbox(), 'End');
    expect(active()?.textContent).toBe('Handbook');
    await key(listbox(), 'Enter');
    expect(mocks.navigate).toHaveBeenLastCalledWith({ to: '/app/projects/$projectId', params: { projectId: 'hand' } });
  });

  it('opens a website on click', async () => {
    await render();
    await act(async () => options()[0]?.click());
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/projects/$projectId', params: { projectId: 'docs' } });
  });

  it('typing in the list moves to search and filters; ArrowDown returns to the list', async () => {
    await render();
    await key(listbox(), 'h');
    expect(document.activeElement).toBe(search());
    expect(search().value).toBe('h');
    await type(search(), 'hand');
    expect(options().map((node) => node.textContent)).toEqual(['Handbook']);
    expect(active()?.textContent).toBe('Handbook');
    await key(search(), 'ArrowDown');
    expect(document.activeElement).toBe(listbox());
    await key(listbox(), 'Enter');
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/projects/$projectId', params: { projectId: 'hand' } });
  });

  it('matches the domain too and says when nothing matches', async () => {
    await render();
    await type(search(), 'docs.nibleaf');
    expect(options().map((node) => node.textContent)).toEqual(['Developer docs']);
    await type(search(), 'zzz');
    expect(options()).toHaveLength(0);
    expect(listbox().querySelector('[role="status"]')?.textContent).toBe('switcher.noResults');
  });

  it('shows the empty state when the org has no websites you can open', async () => {
    mocks.websites.acme = [];
    await render(null);
    expect(options()).toHaveLength(0);
    expect(listbox().querySelector('[role="status"]')?.textContent).toBe('switcher.noWebsitesMember');
  });

  it('shows a busy skeleton while the websites load, and a loading trigger without a project', async () => {
    mocks.pending = true;
    const host = await render(null);
    expect(host.querySelector('button')?.getAttribute('aria-label')).toBe('common.loading');
    expect(listbox().querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(options()).toHaveLength(0);
  });
});
