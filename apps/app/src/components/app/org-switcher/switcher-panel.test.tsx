// @vitest-environment jsdom
import { DirectionProvider } from '@nibleaf/design-system/components/ui/direction';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Org = { id: string; slug: string; name: string; logo: null; orgRole: 'owner' | 'admin' | 'member'; canCreateWebsite: boolean; websiteCount: number };
type Site = { id: string; name: string; icon: null; domain: string | null; live: boolean };

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  compact: false,
  organizations: [] as Org[],
  recent: [] as Array<Site & { organization: { id: string; slug: string; name: string } }>,
  websites: {} as Record<string, Site[]>,
  pending: new Set<string>(),
  openCreateOrganization: vi.fn(),
}));

vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, vars?: Record<string, string>) => (vars ? `${key}(${Object.values(vars).join('|')})` : key),
}));
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  Link: ({ children, to, params, search: _search, onClick, ...props }: { children: ReactNode; to: string; params?: Record<string, string>; search?: unknown; onClick?: () => void }) => (
    <a href={to.replace('$orgSlug', params?.orgSlug ?? '')} onClick={onClick} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('./use-compact-switcher', () => ({ useCompactSwitcher: () => mocks.compact }));
vi.mock('./switcher-context', () => ({ useSwitcherControls: () => ({ openCreateOrganization: mocks.openCreateOrganization }) }));
vi.mock('@/hooks/api', () => {
  const options = (id?: string) => ({
    queryKey: ['organizations', id ?? '', 'projects', 'switcher'],
    queryFn: async () => mocks.websites[id ?? ''] ?? [],
  });
  return {
    useSwitcher: () => ({ data: { organizations: mocks.organizations, recent: mocks.recent, landing: null }, isPending: false }),
    organizationSwitcherProjectsQueryOptions: options,
    useOrganizationSwitcherProjects: (id?: string) =>
      id && mocks.pending.has(id) ? { isPending: true } : { data: id ? (mocks.websites[id] ?? []) : undefined, isPending: !id },
  };
});

import { SwitcherPanel } from './switcher-panel';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;
const onClose = vi.fn();
const org = (id: string, name: string, orgRole: Org['orgRole'] = 'member'): Org => ({
  id,
  slug: id,
  name,
  logo: null,
  orgRole,
  canCreateWebsite: orgRole !== 'member',
  websiteCount: 2,
});
const site = (id: string, name: string, live = true, domain: string | null = `${id}.nibleaf.app`): Site => ({ id, name, icon: null, domain, live });

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  Element.prototype.scrollIntoView = vi.fn();
  mocks.compact = false;
  mocks.pending = new Set();
  mocks.organizations = [org('acme', 'Acme Docs', 'owner'), org('jood', 'JOODPMS'), org('sara', "Sara's org", 'admin')];
  mocks.recent = [{ ...site('api', 'API reference'), organization: { id: 'acme', slug: 'acme', name: 'Acme Docs' } }];
  mocks.websites = {
    acme: [site('docs', 'Developer docs'), site('api', 'API reference'), site('hand', 'Handbook', false, null)],
    jood: [site('pms', 'PMS guide')],
    sara: [],
  };
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

async function render(props: { current?: string; project?: string; direction?: 'ltr' | 'rtl'; pane?: 'orgs' | 'websites' } = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <DirectionProvider direction={props.direction ?? 'ltr'}>
          <div dir={props.direction ?? 'ltr'}>
            <SwitcherPanel currentOrganizationId={props.current ?? 'acme'} currentProjectId={props.project} initialPane={props.pane} onClose={onClose} />
          </div>
        </DirectionProvider>
      </QueryClientProvider>,
    ),
  );
  return host;
}
const listboxes = () => [...document.querySelectorAll<HTMLElement>('[role="listbox"]')];
const left = () => listboxes()[0] as HTMLElement;
const right = () => listboxes()[listboxes().length - 1] as HTMLElement;
const active = (listbox: HTMLElement) => document.getElementById(listbox.getAttribute('aria-activedescendant') ?? '');
const key = (target: Element, name: string) =>
  act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true }));
  });

describe('organization switcher panel', () => {
  it('shows Recent and Organizations on the left and the current org websites on the right', async () => {
    await render({ project: 'api' });
    expect(left().getAttribute('aria-label')).toBe('switcher.organizations');
    expect(left().textContent).toContain('switcher.recent');
    expect(left().textContent).toContain('API reference · Acme Docs');
    // Current org first, with its role badge.
    const orgOptions = [...left().querySelectorAll('[role="option"]')].filter((node) => node.id.endsWith('org-acme') || node.id.includes('org-'));
    expect(orgOptions[0]?.textContent).toContain('Acme Docs');
    expect(orgOptions[0]?.textContent).toContain('roles.owner');
    expect(orgOptions[0]?.getAttribute('aria-selected')).toBe('true');
    expect(right().getAttribute('aria-label')).toBe('switcher.websitesIn(Acme Docs)');
    expect([...right().querySelectorAll('[role="option"]')].map((node) => node.getAttribute('aria-label'))).toEqual([
      'switcher.websiteLabel(Developer docs|Acme Docs|switcher.status.live)',
      'switcher.websiteLabel(API reference|Acme Docs|switcher.status.live)',
      'switcher.websiteLabel(Handbook|Acme Docs|switcher.status.draft)',
    ]);
    // The current website is marked selected.
    expect(right().querySelector('[aria-selected="true"]')?.getAttribute('aria-label')).toContain('API reference');
    // Footer: New website for the shown org (Owner), and New organization always.
    expect(document.body.textContent).toContain('switcher.newWebsiteIn(Acme Docs)');
    expect(document.body.textContent).toContain('switcher.newOrganization');
  });

  it('moves with arrows inside a pane, previews the focused org and opens it with Enter', async () => {
    await render();
    const list = left();
    expect(document.activeElement).toBe(list);
    expect(active(list)?.textContent).toContain('Acme Docs');
    await key(list, 'ArrowDown');
    expect(active(list)?.textContent).toContain('JOODPMS');
    // Focus wins: the right pane follows the arrow-focused org.
    expect(right().getAttribute('aria-label')).toBe('switcher.websitesIn(JOODPMS)');
    // A Member's org offers no "New website".
    expect(document.body.textContent).not.toContain('switcher.newWebsiteIn');
    await key(list, 'End');
    expect(active(list)?.textContent).toContain("Sara's org");
    expect(right().textContent).toContain('switcher.noWebsitesAdmin');
    await key(list, 'Home');
    expect(active(list)?.textContent).toContain('API reference');
    await key(list, 'ArrowDown');
    await key(list, 'Enter');
    expect(onClose).toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/o/$orgSlug/websites', params: { orgSlug: 'acme' } });
  });

  it('moves to the websites pane with ArrowRight and back with ArrowLeft, then opens a website', async () => {
    await render();
    await key(left(), 'ArrowRight');
    expect(document.activeElement).toBe(right());
    expect(active(right())?.getAttribute('aria-label')).toContain('Developer docs');
    await key(right(), 'ArrowDown');
    await key(right(), 'Enter');
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/projects/$projectId', params: { projectId: 'api' } });
    await key(right(), 'ArrowLeft');
    expect(document.activeElement).toBe(left());
  });

  it('mirrors the pane arrows in RTL', async () => {
    await render({ direction: 'rtl' });
    await key(left(), 'ArrowRight');
    expect(document.activeElement).toBe(left());
    await key(left(), 'ArrowLeft');
    expect(document.activeElement).toBe(right());
    await key(right(), 'ArrowRight');
    expect(document.activeElement).toBe(left());
  });

  it('previews an org on hover too, and a member org with no websites says so', async () => {
    mocks.websites.jood = [];
    await render();
    const jood = [...left().querySelectorAll<HTMLElement>('[role="option"]')].find((node) => node.textContent?.includes('JOODPMS'));
    await act(async () => jood?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(right().getAttribute('aria-label')).toBe('switcher.websitesIn(JOODPMS)');
    expect(right().textContent).toContain('switcher.noWebsitesMember');
  });

  it('shows a skeleton in the websites pane while an org loads', async () => {
    mocks.pending.add('acme');
    await render();
    expect(right().querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('typing in a list focuses search, and search lists orgs and websites together', async () => {
    await render();
    await key(left(), 'p');
    const search = document.querySelector<HTMLInputElement>('input[type="search"]');
    expect(document.activeElement).toBe(search);
    expect(search?.value).toBe('p');
    // The combined list loads each org's websites, then matches.
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(search, 'docs');
      search?.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(left().getAttribute('aria-label')).toBe('switcher.results');
    const labels = [...left().querySelectorAll('[role="option"]')].map((node) => node.textContent);
    expect(labels[0]).toContain('Acme Docs');
    expect(labels.some((label) => label?.includes('Developer docs · Acme Docs'))).toBe(true);
  });

  it('leads with the websites when the person belongs to one organization', async () => {
    mocks.organizations = [org('acme', 'Acme Docs', 'owner')];
    mocks.recent = [];
    await render();
    expect(listboxes()).toHaveLength(1);
    expect(document.activeElement).toBe(right());
    expect(document.body.textContent).not.toContain('switcher.organizations');
    // Still shows the org and "New organization".
    expect(document.body.textContent).toContain('Acme Docs');
    expect(document.body.textContent).toContain('switcher.newOrganization');
  });

  it('starts in the websites pane when opened for a website (G then W without a website trigger)', async () => {
    await render({ pane: 'websites' });
    expect(document.activeElement).toBe(right());
  });

  it('opens Create organization from the footer', async () => {
    await render();
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent?.includes('switcher.newOrganization'));
    await act(async () => button?.click());
    expect(mocks.openCreateOrganization).toHaveBeenCalledOnce();
  });

  it('only shows organization settings (⚙) to Owner/Admin', async () => {
    await render();
    expect(document.querySelector('a[href="/app/o/acme/settings"]')).not.toBeNull();
    await key(left(), 'ArrowDown');
    expect(document.querySelector('a[href="/app/o/jood/settings"]')).toBeNull();
  });

  it('windows a long website list but keeps the active option rendered', async () => {
    mocks.websites.acme = Array.from({ length: 120 }, (_, index) => site(`s${index}`, `Website ${index}`));
    await render();
    await key(left(), 'ArrowRight');
    const rendered = right().querySelectorAll('[role="option"]').length;
    expect(rendered).toBeLessThan(60);
    await key(right(), 'End');
    expect(active(right())?.getAttribute('aria-label')).toContain('Website 119');
  });
});

describe('compact (≤ 640 px) drill-down', () => {
  it('shows one screen at a time: tapping an org opens its websites with a back arrow', async () => {
    mocks.compact = true;
    await render();
    expect(listboxes()).toHaveLength(1);
    expect(left().getAttribute('aria-label')).toBe('switcher.organizations');
    const jood = [...left().querySelectorAll<HTMLElement>('[role="option"]')].find((node) => node.textContent?.includes('JOODPMS'));
    // Rows are at least 44 px tall.
    expect(Number.parseInt(jood?.style.height ?? '0', 10)).toBeGreaterThanOrEqual(44);
    await act(async () => jood?.click());
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(listboxes()).toHaveLength(1);
    expect(right().getAttribute('aria-label')).toBe('switcher.websitesIn(JOODPMS)');
    const back = document.querySelector<HTMLButtonElement>('button[aria-label="switcher.back"]');
    expect(back).not.toBeNull();
    await act(async () => back?.click());
    expect(left().getAttribute('aria-label')).toBe('switcher.organizations');
  });
});
