// @vitest-environment jsdom
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigDirtyProvider } from '@/components/project-settings/shared';
import { type Domain, domainsQueryOptions, type Project } from '@/hooks/api';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { DomainSettings } from './domain-settings';
import { dnsRecords, server } from './fake-domains-api';

const mocks = vi.hoisted(() => ({
  status: 'admin' as 'admin' | 'notAdmin' | 'pending',
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() },
  writeText: vi.fn(async () => undefined),
}));
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, variables?: Record<string, string>) => (variables ? `${key} ${JSON.stringify(variables)}` : key),
  translateFn: (key: string) => key,
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/hooks/use-project-admin-status', () => ({ useProjectAdminStatus: () => ({ status: mocks.status }) }));
// Only the network is faked: the real domain query, mutations, invalidation and
// the app's QueryClient (with its mutation error toasts) run against a small
// stateful server. Every mutation here is server-confirmed (api/hooks.ts), so
// a row only changes once the refreshed list says so.
vi.mock('@/services/api', () => import('./fake-domains-api'));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const domainRow = (id: string, patch: Partial<Domain> = {}): Domain => ({
  id: `domain-${id}`,
  domain: `${id}.example.com`,
  verified: false,
  isPrimary: false,
  dnsStatus: 'PENDING',
  sslStatus: 'PENDING',
  verificationToken: 'token',
  createdAt: '2026-11-01T00:00:00Z',
  verifiedAt: null,
  lastCheckedAt: null,
  lastError: null,
  records: [],
  ...patch,
});
const liveRow = (id: string, patch: Partial<Domain> = {}) => domainRow(id, { verified: true, dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE', ...patch });
const withRecords = (id: string, patch: Partial<Domain> = {}) => domainRow(id, { records: dnsRecords(`${id}.example.com`), ...patch });

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;
let dirty: Set<string>;

/** Lets requests answer, the query cache notify (it batches on a timer) and React render. */
const settle = async () =>
  act(async () => {
    for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });
const render = async (projectId = 'site-1') => {
  await act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <ConfigDirtyProvider report={(id, changed) => (changed ? dirty.add(id) : dirty.delete(id))}>
          <DomainSettings project={{ id: projectId } as Project} />
        </ConfigDirtyProvider>
      </QueryClientProvider>,
    ),
  );
  await settle();
};
const rows = () => [...container.querySelectorAll<HTMLElement>('[data-slot="data-list-item"]')];
const row = (index = 0) => {
  const found = rows()[index];
  if (!found) throw new Error(`Expected domain row ${index}`);
  return found;
};
const hosts = () => rows().map((item) => item.querySelector('[data-slot="data-list-item-title"]')?.textContent?.trim());
const badges = (scope: HTMLElement) => [...scope.querySelectorAll('[data-slot="status-badge"]')].map((badge) => badge.textContent);
const primaryHosts = () => hosts().filter((_, index) => badges(row(index)).includes('settings.domain.status.primary'));
const buttons = (scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>('button')];
const button = (scope: ParentNode, text: string) => buttons(scope).find((b) => b.textContent?.includes(text));
const actionsTrigger = (scope: ParentNode) => buttons(scope).find((b) => b.getAttribute('aria-label')?.startsWith('settings.domain.actionsFor'));
const openMenu = async (scope: ParentNode) => {
  const trigger = actionsTrigger(scope);
  if (!trigger) throw new Error('Expected the row actions');
  await act(async () => trigger.click());
};
/** Closes an open row menu the way a pointer does: the trigger toggles it. */
const closeMenu = async (scope: ParentNode) => {
  await act(async () => actionsTrigger(scope)?.click());
  await settle();
};
const menuItem = (text: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.startsWith(text));
const chooseAction = async (scope: ParentNode, text: string) => {
  await openMenu(scope);
  const item = menuItem(text);
  if (!item) throw new Error(`Expected the ${text} action`);
  await act(async () => item.click());
};
/** Each action a row's menu offers, as `{ key: reason }`: `null` when usable, the reason (or '' when none is given) when disabled. */
const rowActions = async (scope: HTMLElement) => {
  await openMenu(scope);
  const found: Record<string, string | null> = {};
  for (const item of document.querySelectorAll<HTMLElement>('[role="menuitem"]')) {
    const reason = item.querySelector('[data-slot="row-actions-item-reason"]')?.textContent ?? '';
    const key = (item.textContent ?? '').slice(0, (item.textContent ?? '').length - reason.length);
    found[key] = item.getAttribute('aria-disabled') === 'true' ? reason : null;
  }
  await closeMenu(scope);
  expect(document.querySelector('[role="menuitem"]')).toBeNull();
  return found;
};
const checkButton = (scope: HTMLElement) => {
  const found = button(scope, 'settings.domain.retry');
  if (!found) throw new Error('Expected the Check again button');
  return found;
};
const field = () => {
  const label = [...container.querySelectorAll('label')].find((el) => el.textContent === 'settings.domain.add');
  const input = label ? document.getElementById(label.htmlFor) : null;
  if (!(input instanceof HTMLInputElement)) throw new Error('Expected the domain field');
  return input;
};
const typeDomain = async (value: string) => {
  const input = field();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const blur = async (el: HTMLElement) =>
  act(async () => {
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur'));
  });
/** Enter in the field: submits the form, whatever the button shows. */
const submit = async () => {
  await act(async () => {
    field().form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
};
const fieldError = () =>
  (field().getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id))
    .find((node) => node?.dataset.slot === 'settings-row-error')?.textContent;
const release = async (gate: { release: () => void }) => {
  await act(async () => gate.release());
  await settle();
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  queryClient = createQueryClient();
  dirty = new Set();
  server.reset();
  server.seed('site-1', [domainRow('a'), domainRow('b')]);
  mocks.status = 'admin';
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: mocks.writeText }, configurable: true });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('layout', () => {
  it('has one page title and lists each domain in a named list', async () => {
    await render();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelector('h1')?.textContent).toBe('settings.domain.title');
    expect(container.querySelector('ul[data-slot="data-list"]')?.getAttribute('aria-label')).toBe('settings.domain.title');
    expect(hosts()).toEqual(['a.example.com', 'b.example.com']);
  });

  it('loads in the shape of the list, announced once', async () => {
    server.hold('list');
    await render();
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="data-list-skeleton"]')).not.toBeNull();
  });

  it('shows no DNS steps before any domain exists, only the empty state and the add field (AUTH-31)', async () => {
    server.seed('site-1', []);
    await render();
    expect(container.querySelector('[data-slot="empty-state"]')?.textContent).toContain('settings.domain.empty');
    expect(field()).toBeDefined();
    expect(container.textContent).not.toContain('settings.domain.guide.step1');
    expect(container.textContent).not.toContain('settings.domain.dns.heading');
  });

  it('dates the last check with the app formatter', async () => {
    server.seed('site-1', [domainRow('a', { lastCheckedAt: '2026-11-01T10:30:00Z' })]);
    await render();
    const meta = row().querySelector('[data-slot="data-list-item-meta"]')?.textContent ?? '';
    expect(meta).toContain('settings.domain.lastChecked');
    expect(meta).toMatch(/2026/);
  });
});

describe('each setup step has its own badge and explanation', () => {
  it.each([
    [{ dnsStatus: 'PENDING', sslStatus: 'PENDING' }, 'settings.domain.status.provisioning', 'settings.domain.state.waiting', 'pending'],
    [{ dnsStatus: 'ERROR', sslStatus: 'PENDING' }, 'settings.domain.status.dnsError', 'settings.domain.state.dnsProblem', 'danger'],
    [{ dnsStatus: 'VERIFIED', sslStatus: 'PROVISIONING' }, 'settings.domain.status.sslProvisioning', 'settings.domain.state.securing', 'pending'],
    [{ dnsStatus: 'VERIFIED', sslStatus: 'ERROR' }, 'settings.domain.status.sslError', 'settings.domain.state.httpsProblem', 'danger'],
  ] as const)('%o', async (status, badge, help, tone) => {
    server.seed('site-1', [domainRow('a', status)]);
    await render();
    const statusBadge = row().querySelector('[data-slot="status-badge"]');
    expect(statusBadge?.textContent).toBe(badge);
    expect(statusBadge?.getAttribute('data-tone')).toBe(tone);
    expect(row().textContent).toContain(help);
    // Never "waiting for DNS" once DNS is verified.
    if (status.dnsStatus === 'VERIFIED') expect(row().textContent).not.toContain('settings.domain.status.provisioning');
  });

  it('shows a live domain as connected, linked, and still checkable', async () => {
    server.seed('site-1', [liveRow('a')]);
    await render();
    expect(row().querySelector('[data-slot="status-badge"]')?.getAttribute('data-tone')).toBe('success');
    expect(row().textContent).toContain('settings.domain.status.verified');
    expect(row().querySelector('a[href="https://a.example.com"]')).not.toBeNull();
    // After a DNS change the owner can confirm it still works (and learn it was demoted if not).
    expect(await rowActions(row())).toEqual({
      'settings.domain.retry': null,
      'settings.domain.makePrimary': null,
      'settings.domain.remove': null,
    });
  });

  it.each([
    { verified: true, dnsStatus: 'VERIFIED', sslStatus: 'PROVISIONING' },
    { verified: true, dnsStatus: 'ERROR', sslStatus: 'PENDING' },
    { verified: false, dnsStatus: 'PENDING', sslStatus: 'PENDING' },
  ] as const)('does not link a domain that does not serve the docs yet: %o', async (status) => {
    server.seed('site-1', [domainRow('a', status)]);
    await render();
    expect(row().querySelector('a')).toBeNull();
    expect(row().textContent).toContain('a.example.com');
  });

  it('keeps the raw server error behind a technical-details disclosure', async () => {
    server.seed('site-1', [domainRow('a', { dnsStatus: 'ERROR', lastError: 'Ownership TXT record is missing.' })]);
    await render();
    const details = container.querySelector('details');
    expect(details?.querySelector('summary')?.textContent).toBe('settings.domain.technicalDetails');
    expect(details?.textContent).toContain('Ownership TXT record is missing.');
  });

  it('shows the DNS steps and records inside a domain that still needs them, with a copy button per value', async () => {
    server.seed('site-1', [withRecords('a'), liveRow('b', { records: dnsRecords('b.example.com') })]);
    await render();
    expect([...row(0).querySelectorAll('ol li')].map((li) => li.textContent)).toEqual([
      'settings.domain.guide.step1',
      'settings.domain.guide.step2',
      'settings.domain.guide.step3',
    ]);
    expect(row(0).textContent).toContain('nibleaf-verify=token');
    const copyLabels = buttons(row(0))
      .map((b) => b.getAttribute('aria-label') ?? '')
      .filter((label) => label.startsWith('settings.domain.dns.copyField'));
    expect(copyLabels).toHaveLength(4);
    for (const label of copyLabels) expect(label).toContain('a.example.com');
    // The live domain's records are folded away, and it shows no steps.
    expect(row(1).textContent).not.toContain('nibleaf-verify=token');
    expect(row(1).querySelector('ol')).toBeNull();
  });
});

describe('Check again', () => {
  it('names the domain in the button it repeats on every row', async () => {
    server.seed('site-1', [withRecords('a')]);
    await render();
    expect(checkButton(row()).textContent).toContain('a.example.com');
    expect(button(row(), 'settings.domain.configuration')?.textContent).toContain('a.example.com');
    expect(actionsTrigger(row())?.getAttribute('aria-label')).toContain('a.example.com');
  });

  it.each([
    [{ dnsStatus: 'VERIFIED', sslStatus: 'PROVISIONING' }, 'info', 'settings.domain.toast.provisioning', 'settings.domain.status.sslProvisioning'],
    [{ dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE' }, 'success', 'settings.domain.toast.live', 'settings.domain.status.verified'],
    [{ dnsStatus: 'PENDING', sslStatus: 'PENDING' }, 'info', 'settings.domain.toast.waiting', 'settings.domain.status.provisioning'],
    [{ dnsStatus: 'VERIFIED', sslStatus: 'ERROR' }, 'error', 'settings.domain.toast.needsAttention', 'settings.domain.status.sslError'],
  ] as const)('reports the state the check found, and the row shows it once refreshed: %o', async (found, kind, message, badge) => {
    server.onCheck(() => found);
    await render();
    await chooseAction(row(), 'settings.domain.retry');
    await settle();
    expect(server.requests('verify')).toEqual([{ endpoint: 'verify', projectId: 'site-1', id: 'domain-a' }]);
    expect(mocks.toast[kind]).toHaveBeenCalledWith(message);
    expect(badges(row(0))).toEqual([badge]);
    expect(row(0).querySelector('[data-slot="data-list-item-meta"]')?.textContent).toContain('settings.domain.lastChecked');
    // The other row was not checked.
    expect(badges(row(1))).toEqual(['settings.domain.status.provisioning']);
  });

  it('shows progress only on the domain being checked, and locks checks, main address and removal on every row, with the reason', async () => {
    server.seed('site-1', [liveRow('a', { isPrimary: true }), liveRow('b'), withRecords('c'), withRecords('d')]);
    const gate = server.hold('verify');
    await render();
    await act(async () => checkButton(row(2)).click());
    await settle();

    expect(badges(row(2))).toEqual(['settings.domain.status.checking']);
    expect(checkButton(row(2)).getAttribute('aria-busy')).toBe('true');
    expect(badges(row(3))).toEqual(['settings.domain.status.provisioning']);
    expect(checkButton(row(3)).getAttribute('aria-busy')).toBeNull();
    expect(checkButton(row(3)).disabled || checkButton(row(3)).getAttribute('aria-disabled') === 'true').toBe(true);
    expect(row(3).querySelector('[data-slot="button-disabled-reason"]')?.textContent).toBe('settings.domain.status.checking');

    const checking = 'settings.domain.status.checking';
    expect(await rowActions(row(0))).toEqual({ 'settings.domain.retry': checking, 'settings.domain.remove': checking });
    expect(await rowActions(row(1))).toEqual({
      'settings.domain.retry': checking,
      'settings.domain.makePrimary': checking,
      'settings.domain.remove': checking,
    });
    expect(await rowActions(row(3))).toEqual({
      'settings.domain.retry': checking,
      'settings.domain.makePrimary': 'settings.domain.reason.verifyFirst',
      'settings.domain.remove': checking,
    });

    // The check finishes: the row shows what it found, and every action is free again.
    await release(gate);
    expect(badges(row(2))).toEqual(['settings.domain.status.verified']);
    expect(await rowActions(row(1))).toEqual({
      'settings.domain.retry': null,
      'settings.domain.makePrimary': null,
      'settings.domain.remove': null,
    });
    expect(server.requests('verify')).toHaveLength(1);
    expect(server.requests('primary')).toHaveLength(0);
  });

  it('starts one check for two quick clicks', async () => {
    server.seed('site-1', [withRecords('a'), withRecords('b')]);
    const gate = server.hold('verify');
    await render();
    // Both clicks land before React re-renders (and before `isPending` shows).
    await act(async () => {
      checkButton(row(0)).click();
      checkButton(row(1)).click();
      checkButton(row(0)).click();
    });
    await settle();
    expect(server.requests('verify')).toEqual([{ endpoint: 'verify', projectId: 'site-1', id: 'domain-a' }]);
    await release(gate);
    expect(server.requests('verify')).toHaveLength(1);
    expect(mocks.toast.success).toHaveBeenCalledTimes(1);
    expect(badges(row(0))).toEqual(['settings.domain.status.verified']);
    expect(badges(row(1))).toEqual(['settings.domain.status.provisioning']);
  });
});

describe('a check that demotes the main address says so', () => {
  beforeEach(() => {
    server.seed('site-1', [liveRow('a', { isPrimary: true }), liveRow('b')]);
  });

  it('suggests adding back a removed TXT record when the domain still works', async () => {
    server.onCheck(() => ({ dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE', ownershipRecordMissing: true }));
    await render();
    await chooseAction(row(), 'settings.domain.retry');
    await settle();
    expect(mocks.toast.success).toHaveBeenCalledWith('settings.domain.toast.live');
    expect(mocks.toast.info).toHaveBeenCalledWith(expect.stringContaining('settings.domain.toast.txtMissing'));
    expect(mocks.toast.warning).not.toHaveBeenCalled();
    expect(primaryHosts()).toEqual(['a.example.com']);
  });

  it('when the check finds HTTPS broken', async () => {
    server.onCheck(() => ({ dnsStatus: 'VERIFIED', sslStatus: 'ERROR' }));
    await render();
    await chooseAction(row(), 'settings.domain.retry');
    await settle();
    expect(mocks.toast.warning).toHaveBeenCalledWith(expect.stringContaining('settings.domain.toast.demoted'));
    expect(mocks.toast.warning).toHaveBeenCalledWith(expect.stringContaining('a.example.com'));
    // The refreshed list: no main address any more, and the row says what broke.
    expect(primaryHosts()).toEqual([]);
    expect(badges(row(0))).toEqual(['settings.domain.status.sslError']);
  });

  it('when the check fails because a record is gone', async () => {
    server.onCheck(() => ({
      dnsStatus: 'ERROR',
      sslStatus: 'ACTIVE',
      lastError: 'Ownership TXT record is missing.',
      fail: { status: 422, error: { code: 'domain:ownership_missing' } },
    }));
    await render();
    await chooseAction(row(), 'settings.domain.retry');
    await settle();
    expect(mocks.toast.warning).toHaveBeenCalledWith(expect.stringContaining('settings.domain.toast.demoted'));
    // The reason is toasted once, by the mutation.
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
    expect(mocks.toast.error).toHaveBeenCalledWith('settings.domain.error.ownershipMissing');
    // A failed check still stored what it found, and the row is refreshed from it.
    expect(primaryHosts()).toEqual([]);
    expect(badges(row(0))).toEqual(['settings.domain.status.dnsError']);
    expect(row(0).textContent).toContain('Ownership TXT record is missing.');
  });

  it('but not when nothing changed', async () => {
    server.onCheck((domain) => ({
      dnsStatus: domain.dnsStatus,
      sslStatus: domain.sslStatus,
      fail: { status: 503, error: { code: 'domain:check_inconclusive' } },
    }));
    await render();
    await chooseAction(row(), 'settings.domain.retry');
    await settle();
    expect(mocks.toast.warning).not.toHaveBeenCalled();
    expect(mocks.toast.error).toHaveBeenCalledWith('settings.domain.error.checkInconclusive');
    expect(primaryHosts()).toEqual(['a.example.com']);
    expect(badges(row(0))).toEqual(['settings.domain.status.verified', 'settings.domain.status.primary']);
  });
});

describe('restoring a TXT record removed after setup', () => {
  it('opens the folded DNS records of a live domain and lets the owner copy the TXT value again', async () => {
    server.seed('site-1', [liveRow('a', { isPrimary: true, records: dnsRecords('a.example.com') })]);
    server.onCheck(() => ({ dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE', ownershipRecordMissing: true }));
    await render();
    // Live: the records start folded away, but can be opened.
    expect(row().textContent).not.toContain('nibleaf-verify=token');
    expect(button(row(), 'settings.domain.configuration')).toBeDefined();

    // Check again: still live, but the TXT record is gone; the records open.
    await chooseAction(row(), 'settings.domain.retry');
    await settle();
    expect(mocks.toast.info).toHaveBeenCalledWith(expect.stringContaining('settings.domain.toast.txtMissing'));
    expect(row().textContent).toContain('nibleaf-verify=token');
    expect(row().textContent).toContain('settings.domain.dns.purpose.txt');

    // …and the TXT value copied straight from there.
    const copyValue = buttons(row()).find((b) => {
      const label = b.getAttribute('aria-label') ?? '';
      return label.startsWith('settings.domain.dns.copyField') && label.includes('"type":"TXT"') && label.includes('settings.domain.dns.value');
    });
    await act(async () => copyValue?.click());
    expect(mocks.writeText).toHaveBeenCalledWith('nibleaf-verify=token');
    expect(row().textContent).toContain('settings.domain.dns.copied');
  });
});

describe('the main address', () => {
  it('can only move to a domain once it is verified, and says so', async () => {
    server.seed('site-1', [domainRow('a')]);
    await render();
    expect((await rowActions(row()))['settings.domain.makePrimary']).toBe('settings.domain.reason.verifyFirst');
  });

  it('waits for the server before moving the main address (server-confirmed)', async () => {
    server.seed('site-1', [liveRow('a', { isPrimary: true }), liveRow('b')]);
    const gate = server.hold('primary');
    await render();
    await chooseAction(row(1), 'settings.domain.makePrimary');
    await settle();
    expect(server.requests('primary')).toEqual([{ endpoint: 'primary', projectId: 'site-1', id: 'domain-b' }]);
    // Nothing moved yet: the badge stays on the current main address.
    expect(primaryHosts()).toEqual(['a.example.com']);
    await release(gate);
    expect(mocks.toast.success).toHaveBeenCalledWith('settings.domain.toast.primary');
    expect(primaryHosts()).toEqual(['b.example.com']);
  });

  it('locks checks, main address and removal on every row while the main address changes, with the reason', async () => {
    server.seed('site-1', [liveRow('a', { isPrimary: true }), liveRow('b'), liveRow('c'), withRecords('d')]);
    const gate = server.hold('primary');
    await render();
    await chooseAction(row(1), 'settings.domain.makePrimary');
    await settle();

    const saving = 'common.saving';
    expect(await rowActions(row(0))).toEqual({ 'settings.domain.retry': saving, 'settings.domain.remove': saving });
    for (const index of [1, 2]) {
      expect(await rowActions(row(index))).toEqual({
        'settings.domain.retry': saving,
        'settings.domain.makePrimary': saving,
        'settings.domain.remove': saving,
      });
    }
    // A check can demote the main address, so none runs while it moves.
    expect(row(3).querySelector('[data-slot="button-disabled-reason"]')?.textContent).toBe(saving);
    await act(async () => checkButton(row(3)).click());
    await settle();
    expect(server.requests('verify')).toHaveLength(0);

    await release(gate);
    expect(primaryHosts()).toEqual(['b.example.com']);
    expect((await rowActions(row(0)))['settings.domain.makePrimary']).toBeNull();
    expect(row(3).querySelector('[data-slot="button-disabled-reason"]')).toBeNull();
  });

  it('keeps the main address where it was when the change is refused, and says why once', async () => {
    server.seed('site-1', [liveRow('a', { isPrimary: true }), liveRow('b')]);
    server.refuseNext('primary', 409, { code: 'domain:not_ready' });
    await render();
    await chooseAction(row(1), 'settings.domain.makePrimary');
    await settle();
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
    expect(mocks.toast.error).toHaveBeenCalledWith('settings.domain.error.notReady');
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(primaryHosts()).toEqual(['a.example.com']);
  });
});

describe('adding a domain', () => {
  it('connects the bare hostname when a full web address is pasted, and lists it', async () => {
    await render();
    await typeDomain('  HTTPS://Docs.Example.com/help/ ');
    expect(dirty.size).toBeGreaterThan(0);
    await submit();
    expect(server.requests('add')).toEqual([{ endpoint: 'add', projectId: 'site-1', body: { domain: 'docs.example.com' } }]);
    expect(mocks.toast.success).toHaveBeenCalledWith('settings.domain.toast.added');
    expect(field().value).toBe('');
    expect(dirty.size).toBe(0);
    expect(hosts()).toEqual(['a.example.com', 'b.example.com', 'docs.example.com']);
    // A new domain opens on its setup steps.
    expect(row(2).textContent).toContain('settings.domain.guide.step1');
  });

  it('shows no error while typing in a fresh field, then explains once it is left', async () => {
    await render();
    await typeDomain('docs example.com');
    expect(field().getAttribute('aria-invalid')).toBeNull();
    await blur(field());
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(fieldError()).toBe('settings.domain.error.invalid');
    await typeDomain('docs.example.com');
    expect(field().getAttribute('aria-invalid')).toBeNull();
  });

  it('explains what to enter instead of sending something that is not a domain', async () => {
    await render();
    // Two words are never joined into a different domain.
    await typeDomain('docs example.com');
    await submit();
    expect(server.requests('add')).toHaveLength(0);
    expect(fieldError()).toBe('settings.domain.error.invalid');
    expect(field().getAttribute('aria-invalid')).toBe('true');
  });

  it('says nothing about an empty field until the person tries to add it', async () => {
    await render();
    await blur(field());
    expect(field().getAttribute('aria-invalid')).toBeNull();
    await submit();
    expect(server.requests('add')).toHaveLength(0);
    expect(fieldError()).toBe('settings.domain.error.invalid');
  });

  const failAdd = async (status: number, error: Parameters<typeof server.refuseNext>[2]) => {
    server.refuseNext('add', status, error);
    await render();
    await typeDomain('docs.example.com');
    await submit();
    return fieldError();
  };

  it("names the person's own site that already has the domain, under the field", async () => {
    const message = await failAdd(409, {
      code: 'domain:already_connected',
      details: { scope: 'same_workspace', siteName: 'Partner Docs' },
    });
    expect(message).toContain('settings.domain.error.connectedToSite');
    expect(message).toContain('Partner Docs');
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(hosts()).toEqual(['a.example.com', 'b.example.com']);
  });

  it('says only "another organization" when the domain belongs to someone else', async () => {
    expect(await failAdd(409, { code: 'domain:already_connected', details: { scope: 'other_workspace' } })).toBe(
      'settings.domain.error.connectedElsewhere',
    );
  });

  it('falls back to "another organization" if a same-organization answer has no name', async () => {
    expect(await failAdd(409, { code: 'domain:already_connected', details: { scope: 'same_workspace' } })).toBe(
      'settings.domain.error.connectedElsewhere',
    );
  });

  it('says the domain is already on this site, and clears that once the field changes', async () => {
    server.seed('site-1', [domainRow('docs')]);
    await render();
    await typeDomain('docs.example.com');
    await submit();
    expect(server.requests('add')).toHaveLength(1);
    expect(fieldError()).toBe('settings.domain.error.alreadyAdded');
    expect(hosts()).toEqual(['docs.example.com']);
    await typeDomain('docs2.example.com');
    expect(fieldError()).toBeUndefined();
  });

  it('toasts a failure that is not about the domain itself and keeps what was typed', async () => {
    expect(await failAdd(502, { code: 'domain:provider_failed' })).toBeUndefined();
    expect(mocks.toast.error).toHaveBeenCalledTimes(1);
    expect(mocks.toast.error).toHaveBeenCalledWith('settings.domain.error.providerFailed');
    expect(field().value).toBe('docs.example.com');
  });

  it('warns that a root domain may not accept a CNAME record', async () => {
    await render();
    await typeDomain('example.com');
    const described = (field().getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(described.join(' ')).toContain('settings.domain.apexHint');
  });
});

describe('adding a domain while the add is in flight', () => {
  it('keeps what was typed during the add, and lists the added domain', async () => {
    const gate = server.hold('add');
    await render();
    await typeDomain('docs.example.com');
    await submit();
    await typeDomain('help.example.com');
    await release(gate);
    expect(hosts()).toEqual(['a.example.com', 'b.example.com', 'docs.example.com']);
    expect(mocks.toast.success).toHaveBeenCalledWith('settings.domain.toast.added');
    expect(field().value).toBe('help.example.com');
    expect(fieldError()).toBeUndefined();
    // The new text is still unsaved work.
    expect(dirty.size).toBeGreaterThan(0);
  });

  it('puts a refusal of the sent address under the field only while the field still holds it', async () => {
    server.seed('site-1', [domainRow('docs')]);
    const first = server.hold('add');
    await render();
    await typeDomain('docs.example.com');
    await submit();
    await typeDomain('help.example.com');
    await release(first);
    // The refusal was about docs.example.com, not what the field holds now.
    expect(fieldError()).toBeUndefined();
    expect(field().getAttribute('aria-invalid')).toBeNull();
    expect(field().value).toBe('help.example.com');

    // …and the new text can be added straight away.
    await submit();
    expect(server.requests('add').map((request) => request.body)).toEqual([{ domain: 'docs.example.com' }, { domain: 'help.example.com' }]);
    expect(hosts()).toEqual(['docs.example.com', 'help.example.com']);
    expect(field().value).toBe('');

    // When the field still holds the refused address, the refusal shows there.
    const third = server.hold('add');
    await typeDomain('docs.example.com');
    await submit();
    await release(third);
    expect(fieldError()).toBe('settings.domain.error.alreadyAdded');
    expect(field().value).toBe('docs.example.com');
  });

  it('sends one add for repeated Enter while it runs', async () => {
    const gate = server.hold('add');
    await render();
    await typeDomain('docs.example.com');
    await submit();
    await submit();
    await submit();
    expect(server.requests('add')).toHaveLength(1);
    await release(gate);
    expect(server.requests('add')).toHaveLength(1);
    expect(mocks.toast.success).toHaveBeenCalledTimes(1);
    expect(hosts()).toEqual(['a.example.com', 'b.example.com', 'docs.example.com']);
  });

  it.each([
    ['succeeds', (gate: ReturnType<typeof server.hold>) => gate.release()],
    ['is refused', (gate: ReturnType<typeof server.hold>) => gate.refuse(409, { code: 'domain:already_added' })],
  ])("leaves another site's form alone when the add started on the first site %s", async (outcome, settleAdd) => {
    server.seed('site-2', [domainRow('other')]);
    const gate = server.hold('add');
    await render('site-1');
    await typeDomain('docs.example.com');
    await submit();

    // The person moves to another site while the add runs (its domains already
    // loaded by the route, so the same form stays on screen), and types the
    // same address there.
    const input = field();
    await act(async () => queryClient.prefetchQuery(domainsQueryOptions('site-2')));
    await render('site-2');
    expect(field()).toBe(input);
    expect(hosts()).toEqual(['other.example.com']);
    expect(field().value).toBe('');
    await typeDomain('docs.example.com');
    await act(async () => settleAdd(gate));
    await settle();

    expect(field().value).toBe('docs.example.com');
    expect(fieldError()).toBeUndefined();
    expect(field().getAttribute('aria-invalid')).toBeNull();
    expect(hosts()).toEqual(['other.example.com']);
    // The first site's outcome is still reported; only this site's form is left alone.
    const reportedAdded = mocks.toast.success.mock.calls.some(([message]) => message === 'settings.domain.toast.added');
    expect(reportedAdded).toBe(outcome === 'succeeds');
    // The form is free for this site's own add.
    await submit();
    expect(server.requests('add').map((request) => request.projectId)).toEqual(['site-1', 'site-2']);
    expect(hosts()).toEqual(['other.example.com', 'docs.example.com']);
  });
});

describe('removing a domain', () => {
  const dialog = () => document.querySelector<HTMLElement>('[data-slot="action-dialog"]');
  const confirm = async () => {
    await act(async () =>
      buttons(dialog() ?? document)
        .find((b) => b.type === 'submit')
        ?.click(),
    );
    await settle();
  };

  it('asks first, naming the domain, then removes it and confirms', async () => {
    await render();
    await chooseAction(row(), 'settings.domain.remove');
    expect(dialog()?.textContent).toContain('settings.domain.removeConfirm');
    expect(dialog()?.textContent).toContain('a.example.com');
    await confirm();
    expect(server.requests('remove')).toEqual([{ endpoint: 'remove', projectId: 'site-1', id: 'domain-a' }]);
    expect(mocks.toast.success).toHaveBeenCalledWith('settings.domain.toast.removed');
    expect(hosts()).toEqual(['b.example.com']);
  });

  it('keeps the dialog open with a plain-language error when removing fails', async () => {
    server.refuseNext('remove', 500, { message: 'boom' });
    await render();
    await chooseAction(row(), 'settings.domain.remove');
    await confirm();
    expect(dialog()?.querySelector('[data-slot="action-dialog-error"]')?.textContent).toBeTruthy();
    expect(dialog()?.textContent).not.toContain('boom');
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(mocks.toast.success).not.toHaveBeenCalled();
    expect(hosts()).toEqual(['a.example.com', 'b.example.com']);
  });

  it('does nothing when the confirmation is cancelled', async () => {
    await render();
    await chooseAction(row(), 'settings.domain.remove');
    await act(async () => button(dialog() ?? document, 'common.cancel')?.click());
    await settle();
    expect(server.requests('remove')).toHaveLength(0);
    expect(hosts()).toEqual(['a.example.com', 'b.example.com']);
  });
});

describe('access', () => {
  it('shows a read-only section to non-admins: one note, no add field, no row actions', async () => {
    mocks.status = 'notAdmin';
    server.seed('site-1', [withRecords('a')]);
    await render();
    expect(container.querySelectorAll('[data-slot="callout"]')).toHaveLength(1);
    expect(container.textContent).toContain('settings.permissions.title');
    expect(container.querySelector('input')).toBeNull();
    expect(actionsTrigger(container)).toBeUndefined();
    expect(button(row(), 'settings.domain.retry')).toBeUndefined();
  });

  it('locks the controls without a reason while access is unknown', async () => {
    mocks.status = 'pending';
    await render();
    expect(container.querySelector('[data-slot="callout"]')).toBeNull();
    expect(field().disabled).toBe(true);
    expect(button(container, 'settings.domain.add')?.disabled).toBe(true);
    expect(await rowActions(row())).toEqual({
      'settings.domain.retry': '',
      'settings.domain.makePrimary': '',
      'settings.domain.remove': '',
    });
  });
});
