// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigDirtyProvider } from '@/components/project-settings/shared';
import type { Domain, Project } from '@/hooks/api';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { DomainSettings } from './domain-settings';

const mocks = vi.hoisted(() => ({
  verify: { isPending: false, variables: undefined as string | undefined, mutate: vi.fn() },
  add: { isPending: false, mutateAsync: vi.fn() },
  remove: { mutateAsync: vi.fn() },
  setPrimary: { isPending: false, variables: undefined as string | undefined, mutate: vi.fn() },
  domains: undefined as unknown,
  domainsPending: false,
  status: 'admin' as 'admin' | 'notAdmin' | 'pending',
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() },
  writeText: vi.fn(async () => undefined),
}));
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, variables?: Record<string, string>) => (variables ? `${key} ${JSON.stringify(variables)}` : key),
  translateFn: (key: string) => key,
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/hooks/api', async () => vi.importActual<object>('@/hooks/api/domain-state'));
vi.mock('@/hooks/use-project-admin-status', () => ({ useProjectAdminStatus: () => ({ status: mocks.status }) }));
// Class per mutation: add, check, set primary and remove are all server-confirmed (api/hooks.ts); none is optimistic.
vi.mock('../api/hooks', () => ({
  useSiteDomains: () =>
    mocks.domainsPending
      ? { data: undefined, isPending: true, isError: false, isFetching: true, refetch: vi.fn() }
      : { data: mocks.domains, isPending: false, isError: false, isFetching: false, refetch: vi.fn() },
  useAddSiteDomain: () => mocks.add,
  useCheckSiteDomain: () => mocks.verify,
  useSetPrimarySiteDomain: () => mocks.setPrimary,
  useRemoveSiteDomain: () => mocks.remove,
}));
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
const RECORDS = (host: string) => [
  { type: 'CNAME', name: host, value: 'cname.nibleaf.test', ttl: 3600 },
  { type: 'TXT', name: `_nibleaf.${host}`, value: 'nibleaf-verify=token', ttl: 3600 },
];

let container: HTMLDivElement;
let root: Root;
let dirty: Set<string>;
const render = async () =>
  act(async () =>
    root.render(
      <ConfigDirtyProvider report={(id, changed) => (changed ? dirty.add(id) : dirty.delete(id))}>
        <DomainSettings project={{ id: 'site-1' } as Project} />
      </ConfigDirtyProvider>,
    ),
  );
const rows = () => [...container.querySelectorAll<HTMLElement>('[data-slot="data-list-item"]')];
const row = (index = 0) => {
  const found = rows()[index];
  if (!found) throw new Error(`Expected domain row ${index}`);
  return found;
};
const buttons = (scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>('button')];
const button = (scope: ParentNode, text: string) => buttons(scope).find((b) => b.textContent?.includes(text));
const actionsTrigger = (scope: ParentNode) => buttons(scope).find((b) => b.getAttribute('aria-label')?.startsWith('settings.domain.actionsFor'));
const openMenu = async (scope: ParentNode) => {
  const trigger = actionsTrigger(scope);
  if (!trigger) throw new Error('Expected the row actions');
  await act(async () => trigger.click());
};
const menuItem = (text: string) =>
  [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.startsWith(text));
const chooseAction = async (scope: ParentNode, text: string) => {
  await openMenu(scope);
  const item = menuItem(text);
  if (!item) throw new Error(`Expected the ${text} action`);
  await act(async () => item.click());
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
const submit = async () =>
  act(async () => {
    field().form?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
const fieldError = () =>
  (field().getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id))
    .find((node) => node?.dataset.slot === 'settings-row-error')?.textContent;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  dirty = new Set();
  mocks.domains = [domainRow('a'), domainRow('b')];
  mocks.status = 'admin';
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: mocks.writeText }, configurable: true });
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
  mocks.verify.isPending = false;
  mocks.verify.variables = undefined;
  mocks.setPrimary.isPending = false;
  mocks.setPrimary.variables = undefined;
  mocks.add.isPending = false;
});

describe('layout', () => {
  it('has one page title and lists each domain in a named list', async () => {
    await render();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    expect(container.querySelector('h1')?.textContent).toBe('settings.domain.title');
    expect(container.querySelector('ul[data-slot="data-list"]')?.getAttribute('aria-label')).toBe('settings.domain.title');
    expect(rows()).toHaveLength(2);
  });

  it('loads in the shape of the list, announced once', async () => {
    mocks.domainsPending = true;
    try {
      await render();
      expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
      expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
      expect(container.querySelector('[data-slot="data-list-skeleton"]')).not.toBeNull();
    } finally {
      mocks.domainsPending = false;
    }
  });

  it('shows no DNS steps before any domain exists, only the empty state and the add field (AUTH-31)', async () => {
    mocks.domains = [];
    await render();
    expect(container.querySelector('[data-slot="empty-state"]')?.textContent).toContain('settings.domain.empty');
    expect(field()).toBeDefined();
    expect(container.textContent).not.toContain('settings.domain.guide.step1');
    expect(container.textContent).not.toContain('settings.domain.dns.heading');
  });

  it('dates the last check with the app formatter', async () => {
    mocks.domains = [domainRow('a', { lastCheckedAt: '2026-11-01T10:30:00Z' })];
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
    mocks.domains = [domainRow('a', status)];
    await render();
    const statusBadge = row().querySelector('[data-slot="status-badge"]');
    expect(statusBadge?.textContent).toBe(badge);
    expect(statusBadge?.getAttribute('data-tone')).toBe(tone);
    expect(row().textContent).toContain(help);
    // Never "waiting for DNS" once DNS is verified.
    if (status.dnsStatus === 'VERIFIED') expect(row().textContent).not.toContain('settings.domain.status.provisioning');
  });

  it('shows a live domain as connected, linked, and still checkable', async () => {
    mocks.domains = [liveRow('a')];
    await render();
    expect(row().querySelector('[data-slot="status-badge"]')?.getAttribute('data-tone')).toBe('success');
    expect(row().textContent).toContain('settings.domain.status.verified');
    expect(row().querySelector('a[href="https://a.example.com"]')).not.toBeNull();
    // After a DNS change the owner can confirm it still works (and learn it was demoted if not).
    await openMenu(row());
    expect(menuItem('settings.domain.retry')?.getAttribute('aria-disabled')).toBeNull();
    expect(menuItem('settings.domain.makePrimary')?.getAttribute('aria-disabled')).toBeNull();
  });

  it.each([
    { verified: true, dnsStatus: 'VERIFIED', sslStatus: 'PROVISIONING' },
    { verified: true, dnsStatus: 'ERROR', sslStatus: 'PENDING' },
    { verified: false, dnsStatus: 'PENDING', sslStatus: 'PENDING' },
  ] as const)('does not link a domain that does not serve the docs yet: %o', async (status) => {
    mocks.domains = [domainRow('a', status)];
    await render();
    expect(row().querySelector('a')).toBeNull();
    expect(row().textContent).toContain('a.example.com');
  });

  it('keeps the raw server error behind a technical-details disclosure', async () => {
    mocks.domains = [domainRow('a', { dnsStatus: 'ERROR', lastError: 'Ownership TXT record is missing.' })];
    await render();
    const details = container.querySelector('details');
    expect(details?.querySelector('summary')?.textContent).toBe('settings.domain.technicalDetails');
    expect(details?.textContent).toContain('Ownership TXT record is missing.');
  });

  it('shows the DNS steps and records inside a domain that still needs them, with a copy button per value', async () => {
    mocks.domains = [domainRow('a', { records: RECORDS('a.example.com') }), liveRow('b', { records: RECORDS('b.example.com') })];
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
  it('shows progress only on the domain being checked', async () => {
    mocks.domains = [domainRow('a', { records: RECORDS('a.example.com') }), domainRow('b', { records: RECORDS('b.example.com') })];
    mocks.verify.isPending = true;
    mocks.verify.variables = 'domain-a';
    await render();
    expect(row(0).querySelector('[data-slot="status-badge"]')?.textContent).toBe('settings.domain.status.checking');
    expect(row(1).querySelector('[data-slot="status-badge"]')?.textContent).toBe('settings.domain.status.provisioning');
    expect(button(row(0), 'settings.domain.retry')?.getAttribute('aria-busy')).toBe('true');
    expect(button(row(1), 'settings.domain.retry')?.getAttribute('aria-busy')).toBeNull();
    expect(button(row(1), 'settings.domain.retry')?.disabled).toBe(false);
  });

  it('names the domain in the button it repeats on every row', async () => {
    mocks.domains = [domainRow('a', { records: RECORDS('a.example.com') })];
    await render();
    expect(button(row(), 'settings.domain.retry')?.textContent).toContain('a.example.com');
    expect(button(row(), 'settings.domain.configuration')?.textContent).toContain('a.example.com');
    expect(actionsTrigger(row())?.getAttribute('aria-label')).toContain('a.example.com');
  });

  it.each([
    [{ dnsStatus: 'VERIFIED', sslStatus: 'PROVISIONING' }, 'info', 'settings.domain.toast.provisioning'],
    [{ dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE' }, 'success', 'settings.domain.toast.live'],
    [{ dnsStatus: 'PENDING', sslStatus: 'PENDING' }, 'info', 'settings.domain.toast.waiting'],
    [{ dnsStatus: 'VERIFIED', sslStatus: 'ERROR' }, 'error', 'settings.domain.toast.needsAttention'],
  ] as const)('reports the state the check found: %o', async (result, kind, message) => {
    await render();
    await chooseAction(row(), 'settings.domain.retry');
    expect(mocks.verify.mutate).toHaveBeenCalledWith('domain-a', expect.any(Object));
    const [, options] = mocks.verify.mutate.mock.calls[0] as [string, { onSuccess: (domain: Partial<Domain>) => void }];
    await act(async () => options.onSuccess(result));
    expect(mocks.toast[kind]).toHaveBeenCalledWith(message);
  });
});

describe('a check that demotes the main address says so', () => {
  const clickCheck = async () => {
    await render();
    await chooseAction(row(), 'settings.domain.retry');
    return mocks.verify.mutate.mock.calls[0] as [string, { onSuccess: (domain: unknown) => void; onError: (error: unknown) => void }];
  };

  it('suggests adding back a removed TXT record when the domain still works', async () => {
    const [, options] = await clickCheck();
    await act(async () => options.onSuccess({ dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE', demoted: false, ownershipRecordMissing: true }));
    expect(mocks.toast.success).toHaveBeenCalledWith('settings.domain.toast.live');
    expect(mocks.toast.info).toHaveBeenCalledWith(expect.stringContaining('settings.domain.toast.txtMissing'));
    expect(mocks.toast.warning).not.toHaveBeenCalled();
  });

  it('when the check finds HTTPS broken', async () => {
    const [, options] = await clickCheck();
    await act(async () => options.onSuccess({ dnsStatus: 'VERIFIED', sslStatus: 'ERROR', demoted: true }));
    expect(mocks.toast.warning).toHaveBeenCalledWith(expect.stringContaining('settings.domain.toast.demoted'));
    expect(mocks.toast.warning).toHaveBeenCalledWith(expect.stringContaining('a.example.com'));
  });

  it('when the check fails because a record is gone', async () => {
    const [, options] = await clickCheck();
    await act(async () =>
      options.onError(
        new ApiResponseError('missing', 422, 'domain:ownership_missing', undefined, undefined, undefined, undefined, { demoted: true }),
      ),
    );
    expect(mocks.toast.warning).toHaveBeenCalledWith(expect.stringContaining('settings.domain.toast.demoted'));
  });

  it('but not when nothing changed', async () => {
    const [, options] = await clickCheck();
    await act(async () => {
      options.onError(new ApiResponseError('no answer', 503, 'domain:check_inconclusive', undefined, undefined, undefined, undefined, {}));
      options.onSuccess({ dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE', demoted: false });
    });
    expect(mocks.toast.warning).not.toHaveBeenCalled();
  });
});

describe('restoring a TXT record removed after setup', () => {
  it('opens the folded DNS records of a live domain and lets the owner copy the TXT value again', async () => {
    mocks.domains = [liveRow('a', { isPrimary: true, records: RECORDS('a.example.com') })];
    await render();
    // Live: the records start folded away, but can be opened.
    expect(row().textContent).not.toContain('nibleaf-verify=token');
    expect(button(row(), 'settings.domain.configuration')).toBeDefined();

    // Check again: still live, but the TXT record is gone; the records open.
    await chooseAction(row(), 'settings.domain.retry');
    const [, options] = mocks.verify.mutate.mock.calls[0] as [string, { onSuccess: (domain: unknown) => void }];
    await act(async () =>
      options.onSuccess({ verified: true, dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE', demoted: false, ownershipRecordMissing: true }),
    );
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
    mocks.domains = [domainRow('a')];
    await render();
    await openMenu(row());
    const item = menuItem('settings.domain.makePrimary');
    expect(item?.getAttribute('aria-disabled')).toBe('true');
    expect(item?.querySelector('[data-slot="row-actions-item-reason"]')?.textContent).toBe('settings.domain.reason.verifyFirst');
  });

  it('waits for the server before showing the new main address (server-confirmed)', async () => {
    mocks.domains = [liveRow('a', { isPrimary: true }), liveRow('b')];
    await render();
    await chooseAction(row(1), 'settings.domain.makePrimary');
    expect(mocks.setPrimary.mutate).toHaveBeenCalledWith('domain-b', expect.any(Object));
    // Nothing moved yet: the badge stays on the current main address.
    expect(row(0).textContent).toContain('settings.domain.status.primary');
    expect(row(1).textContent).not.toContain('settings.domain.status.primary');
    const [, options] = mocks.setPrimary.mutate.mock.calls[0] as [string, { onSuccess: () => void }];
    await act(async () => options.onSuccess());
    expect(mocks.toast.success).toHaveBeenCalledWith('settings.domain.toast.primary');
  });

  it('holds the other rows while the main address changes', async () => {
    mocks.domains = [liveRow('a', { isPrimary: true }), liveRow('b'), liveRow('c')];
    mocks.setPrimary.isPending = true;
    mocks.setPrimary.variables = 'domain-b';
    await render();
    await openMenu(row(2));
    expect(menuItem('settings.domain.makePrimary')?.querySelector('[data-slot="row-actions-item-reason"]')?.textContent).toBe('common.saving');
  });
});

describe('adding a domain', () => {
  it('connects the bare hostname when a full web address is pasted', async () => {
    mocks.add.mutateAsync.mockResolvedValue({});
    await render();
    await typeDomain('  HTTPS://Docs.Example.com/help/ ');
    expect(dirty.size).toBeGreaterThan(0);
    await submit();
    expect(mocks.add.mutateAsync).toHaveBeenCalledWith({ domain: 'docs.example.com' });
    expect(mocks.toast.success).toHaveBeenCalledWith('settings.domain.toast.added');
    expect(field().value).toBe('');
    expect(dirty.size).toBe(0);
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
    expect(mocks.add.mutateAsync).not.toHaveBeenCalled();
    expect(fieldError()).toBe('settings.domain.error.invalid');
    expect(field().getAttribute('aria-invalid')).toBe('true');
  });

  it('says nothing about an empty field until the person tries to add it', async () => {
    await render();
    await blur(field());
    expect(field().getAttribute('aria-invalid')).toBeNull();
    await submit();
    expect(mocks.add.mutateAsync).not.toHaveBeenCalled();
    expect(fieldError()).toBe('settings.domain.error.invalid');
  });

  const failAdd = async (error: unknown) => {
    mocks.add.mutateAsync.mockRejectedValueOnce(error);
    await render();
    await typeDomain('docs.example.com');
    await submit();
    return fieldError();
  };

  it("names the person's own site that already has the domain, under the field", async () => {
    const message = await failAdd(
      new ApiResponseError('x', 409, 'domain:already_connected', undefined, undefined, undefined, undefined, {
        scope: 'same_workspace',
        siteName: 'Partner Docs',
      }),
    );
    expect(message).toContain('settings.domain.error.connectedToSite');
    expect(message).toContain('Partner Docs');
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it('says only "another workspace" when the domain belongs to someone else', async () => {
    expect(
      await failAdd(
        new ApiResponseError('x', 409, 'domain:already_connected', undefined, undefined, undefined, undefined, { scope: 'other_workspace' }),
      ),
    ).toBe('settings.domain.error.connectedElsewhere');
  });

  it('falls back to "another workspace" if a same-workspace answer has no name', async () => {
    expect(
      await failAdd(
        new ApiResponseError('x', 409, 'domain:already_connected', undefined, undefined, undefined, undefined, { scope: 'same_workspace' }),
      ),
    ).toBe('settings.domain.error.connectedElsewhere');
  });

  it('says the domain is already on this site, and clears that once the field changes', async () => {
    expect(await failAdd(new ApiResponseError('x', 409, 'domain:already_added'))).toBe('settings.domain.error.alreadyAdded');
    await typeDomain('docs2.example.com');
    expect(fieldError()).toBeUndefined();
  });

  it('toasts a failure that is not about the domain itself and keeps what was typed', async () => {
    expect(await failAdd(new ApiResponseError('x', 502, 'domain:provider_failed'))).toBeUndefined();
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

describe('removing a domain', () => {
  const dialog = () => document.querySelector<HTMLElement>('[data-slot="action-dialog"]');

  it('asks first, naming the domain, then removes it and confirms', async () => {
    mocks.remove.mutateAsync.mockResolvedValue(undefined);
    await render();
    await chooseAction(row(), 'settings.domain.remove');
    expect(dialog()?.textContent).toContain('settings.domain.removeConfirm');
    expect(dialog()?.textContent).toContain('a.example.com');
    await act(async () =>
      buttons(dialog() ?? document)
        .find((b) => b.type === 'submit')
        ?.click(),
    );
    expect(mocks.remove.mutateAsync).toHaveBeenCalledWith('domain-a');
    expect(mocks.toast.success).toHaveBeenCalledWith('settings.domain.toast.removed');
  });

  it('keeps the dialog open with a plain-language error when removing fails', async () => {
    mocks.remove.mutateAsync.mockRejectedValue(new Error('boom'));
    await render();
    await chooseAction(row(), 'settings.domain.remove');
    await act(async () =>
      buttons(dialog() ?? document)
        .find((b) => b.type === 'submit')
        ?.click(),
    );
    expect(dialog()?.querySelector('[data-slot="action-dialog-error"]')?.textContent).toBeTruthy();
    expect(dialog()?.textContent).not.toContain('boom');
    expect(mocks.toast.error).not.toHaveBeenCalled();
  });

  it('does nothing when the confirmation is cancelled', async () => {
    await render();
    await chooseAction(row(), 'settings.domain.remove');
    await act(async () => button(dialog() ?? document, 'common.cancel')?.click());
    expect(mocks.remove.mutateAsync).not.toHaveBeenCalled();
  });
});

describe('access', () => {
  it('shows a read-only section to non-admins: one note, no add field, no row actions', async () => {
    mocks.status = 'notAdmin';
    mocks.domains = [domainRow('a', { records: RECORDS('a.example.com') })];
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
    await openMenu(row());
    for (const item of document.querySelectorAll('[role="menuitem"]')) {
      expect(item.getAttribute('aria-disabled')).toBe('true');
      expect(item.querySelector('[data-slot="row-actions-item-reason"]')).toBeNull();
    }
  });
});
