// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Domain, Project } from '@/hooks/api';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { DomainSection } from './domain-section';

const mocks = vi.hoisted(() => ({
  verify: { isPending: false, variables: undefined as string | undefined, mutate: vi.fn() },
  add: { isPending: false, mutate: vi.fn() },
  remove: { isPending: false, variables: undefined as string | undefined, mutate: vi.fn() },
  setPrimary: { isPending: false, variables: undefined as string | undefined, mutate: vi.fn() },
  confirm: vi.fn(),
  domains: undefined as unknown,
  domainsPending: false,
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() },
  copy: vi.fn(async () => true),
}));
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, variables?: Record<string, string>) => (variables ? `${key} ${JSON.stringify(variables)}` : key),
  translateFn: (key: string) => key,
}));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/lib/invitations', () => ({ copyToClipboard: mocks.copy }));
vi.mock('@/hooks/api', async () => ({
  ...(await vi.importActual<object>('@/hooks/api/domain-state')),
  useDomains: () => (mocks.domainsPending ? { data: undefined, isPending: true } : { data: mocks.domains, isPending: false }),
  useVerifyDomain: () => mocks.verify,
  useAddDomain: () => mocks.add,
  useDeleteDomain: () => mocks.remove,
  useSetPrimaryDomain: () => mocks.setPrimary,
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

let container: HTMLDivElement;
let root: Root;
const render = async () => act(async () => root.render(<DomainSection project={{ id: 'site-1' } as Project} />));
const rows = () => [...container.querySelectorAll('[data-slot="collapsible"]')];
const button = (scope: ParentNode, text: string) => [...scope.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
const typeDomain = async (value: string) => {
  const input = container.querySelector<HTMLInputElement>('#custom-domain');
  if (!input) throw new Error('Expected the domain field');
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setValue?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const submit = async () =>
  act(async () => {
    container.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  mocks.domains = [domainRow('a'), domainRow('b')];
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
  mocks.verify.isPending = false;
  mocks.verify.variables = undefined;
});

it('shows verification progress only on its domain and renders three independent guide steps', async () => {
  mocks.verify.isPending = true;
  mocks.verify.variables = 'domain-a';
  await render();
  const [firstRow, secondRow] = rows();
  if (!firstRow || !secondRow) throw new Error('Expected two domain rows');
  const first = button(firstRow, 'settings.domain.status.checking');
  expect(first?.disabled).toBe(true);
  const second = button(secondRow, 'settings.domain.retry');
  expect(second?.disabled).toBe(false);
  expect(secondRow.querySelector('button[aria-busy="true"]')).toBeNull();
  expect(first?.getAttribute('aria-busy')).toBe('true');
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect([...container.querySelectorAll('ol li')].map((li) => li.textContent)).toEqual([
    'settings.domain.guide.step1',
    'settings.domain.guide.step2',
    'settings.domain.guide.step3',
  ]);
});

it('loads in the shape of the section: guide steps, the add row and domain cards, announced once', async () => {
  mocks.domainsPending = true;
  try {
    await render();
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    // Card-shaped placeholders, not a stack of labelled form fields.
    expect(container.querySelectorAll('.rounded-xl.border')).toHaveLength(2);
  } finally {
    mocks.domainsPending = false;
  }
});

describe('each setup step has its own badge and explanation', () => {
  it.each([
    [{ dnsStatus: 'PENDING', sslStatus: 'PENDING' }, 'settings.domain.status.provisioning', 'settings.domain.state.waiting'],
    [{ dnsStatus: 'ERROR', sslStatus: 'PENDING' }, 'settings.domain.status.dnsError', 'settings.domain.state.dnsProblem'],
    [{ dnsStatus: 'VERIFIED', sslStatus: 'PROVISIONING' }, 'settings.domain.status.sslProvisioning', 'settings.domain.state.securing'],
    [{ dnsStatus: 'VERIFIED', sslStatus: 'ERROR' }, 'settings.domain.status.sslError', 'settings.domain.state.httpsProblem'],
  ] as const)('%o', async (status, badge, help) => {
    mocks.domains = [domainRow('a', status)];
    await render();
    const text = rows()[0]?.textContent ?? '';
    expect(text).toContain(badge);
    expect(text).toContain(help);
    // Never "waiting for DNS" once DNS is verified.
    if (status.dnsStatus === 'VERIFIED') expect(text).not.toContain('settings.domain.status.provisioning');
  });

  it('shows a live domain as connected, linked, and still checkable', async () => {
    mocks.domains = [domainRow('a', { verified: true, dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE' })];
    await render();
    const [row] = rows();
    if (!row) throw new Error('Expected a domain row');
    expect(row.textContent).toContain('settings.domain.status.verified');
    // After a DNS change the owner can confirm it still works (and learn it was demoted if not).
    expect(button(row, 'settings.domain.retry')?.disabled).toBe(false);
    expect(button(row, 'settings.domain.makePrimary')).toBeDefined();
    expect(row.querySelector('a[href="https://a.example.com"]')).not.toBeNull();
  });

  it.each([
    { verified: true, dnsStatus: 'VERIFIED', sslStatus: 'PROVISIONING' },
    { verified: true, dnsStatus: 'ERROR', sslStatus: 'PENDING' },
    { verified: false, dnsStatus: 'PENDING', sslStatus: 'PENDING' },
  ] as const)('does not link a domain that does not serve the docs yet: %o', async (status) => {
    mocks.domains = [domainRow('a', status)];
    await render();
    expect(rows()[0]?.querySelector('a')).toBeNull();
    expect(rows()[0]?.textContent).toContain('a.example.com');
  });

  it('keeps the raw server error behind a technical-details disclosure', async () => {
    mocks.domains = [domainRow('a', { dnsStatus: 'ERROR', lastError: 'Ownership TXT record is missing.' })];
    await render();
    const details = container.querySelector('details');
    expect(details?.querySelector('summary')?.textContent).toBe('settings.domain.technicalDetails');
    expect(details?.textContent).toContain('Ownership TXT record is missing.');
  });
});

describe('Check again', () => {
  it.each([
    [{ dnsStatus: 'VERIFIED', sslStatus: 'PROVISIONING' }, 'info', 'settings.domain.toast.provisioning'],
    [{ dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE' }, 'success', 'settings.domain.toast.live'],
    [{ dnsStatus: 'PENDING', sslStatus: 'PENDING' }, 'info', 'settings.domain.toast.waiting'],
    [{ dnsStatus: 'VERIFIED', sslStatus: 'ERROR' }, 'error', 'settings.domain.toast.needsAttention'],
  ] as const)('reports the state the check found: %o', async (result, kind, message) => {
    await render();
    const [row] = rows();
    if (!row) throw new Error('Expected a domain row');
    await act(async () => button(row, 'settings.domain.retry')?.click());
    expect(mocks.verify.mutate).toHaveBeenCalledWith('domain-a', expect.any(Object));
    const [, options] = mocks.verify.mutate.mock.calls[0] as [string, { onSuccess: (domain: Partial<Domain>) => void }];
    options.onSuccess(result);
    expect(mocks.toast[kind]).toHaveBeenCalledWith(message);
    expect(mocks.toast[kind]).not.toHaveBeenCalledWith('settings.domain.status.provisioning');
  });
});

describe('a check that demotes the main address says so', () => {
  const clickCheck = async () => {
    await render();
    const [row] = rows();
    if (!row) throw new Error('Expected a domain row');
    await act(async () => button(row, 'settings.domain.retry')?.click());
    return mocks.verify.mutate.mock.calls[0] as [string, { onSuccess: (domain: unknown) => void; onError: (error: unknown) => void }];
  };

  it('suggests adding back a removed TXT record when the domain still works', async () => {
    const [, options] = await clickCheck();
    options.onSuccess({ dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE', demoted: false, ownershipRecordMissing: true });
    expect(mocks.toast.success).toHaveBeenCalledWith('settings.domain.toast.live');
    expect(mocks.toast.info).toHaveBeenCalledWith(expect.stringContaining('settings.domain.toast.txtMissing'));
    expect(mocks.toast.warning).not.toHaveBeenCalled();
  });

  it('when the check finds HTTPS broken', async () => {
    const [, options] = await clickCheck();
    options.onSuccess({ dnsStatus: 'VERIFIED', sslStatus: 'ERROR', demoted: true });
    expect(mocks.toast.warning).toHaveBeenCalledWith(expect.stringContaining('settings.domain.toast.demoted'));
    expect(mocks.toast.warning).toHaveBeenCalledWith(expect.stringContaining('a.example.com'));
  });

  it('when the check fails because a record is gone', async () => {
    const [, options] = await clickCheck();
    options.onError(new ApiResponseError('missing', 422, 'domain:ownership_missing', undefined, undefined, undefined, undefined, { demoted: true }));
    expect(mocks.toast.warning).toHaveBeenCalledWith(expect.stringContaining('settings.domain.toast.demoted'));
  });

  it('but not when nothing changed', async () => {
    const [, options] = await clickCheck();
    options.onError(new ApiResponseError('no answer', 503, 'domain:check_inconclusive', undefined, undefined, undefined, undefined, {}));
    options.onSuccess({ dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE', demoted: false });
    expect(mocks.toast.warning).not.toHaveBeenCalled();
  });
});

describe('restoring a TXT record removed after setup', () => {
  it('lets the owner open the folded DNS records of a live domain and copy the TXT value again', async () => {
    mocks.domains = [
      domainRow('a', {
        verified: true,
        isPrimary: true,
        dnsStatus: 'VERIFIED',
        sslStatus: 'ACTIVE',
        records: [
          { type: 'CNAME', name: 'a.example.com', value: 'cname.nibleaf.test', ttl: 3600 },
          { type: 'TXT', name: '_nibleaf.a.example.com', value: 'nibleaf-verify=token', ttl: 3600 },
        ],
      }),
    ];
    await render();
    const [row] = rows();
    if (!row) throw new Error('Expected a domain row');
    // Live: the records start folded away.
    expect(row.textContent).not.toContain('nibleaf-verify=token');

    // Check again: still live, but the TXT record is gone.
    await act(async () => button(row, 'settings.domain.retry')?.click());
    const [, options] = mocks.verify.mutate.mock.calls[0] as [string, { onSuccess: (domain: unknown) => void }];
    options.onSuccess({ verified: true, dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE', demoted: false, ownershipRecordMissing: true });
    expect(mocks.toast.info).toHaveBeenCalledWith(expect.stringContaining('settings.domain.toast.txtMissing'));

    // The records can be opened on the live domain…
    const trigger = button(row, 'settings.domain.configuration');
    expect(trigger).toBeDefined();
    await act(async () => trigger?.click());
    expect(row.textContent).toContain('nibleaf-verify=token');
    expect(row.textContent).toContain('settings.domain.dns.purpose.txt');

    // …and the TXT value copied straight from there.
    const copyValue = [...row.querySelectorAll('button')].find(
      (b) =>
        b.getAttribute('aria-label') === 'settings.domain.dns.copy: settings.domain.dns.value' &&
        b.closest('div.rounded-lg')?.textContent?.includes('TXT'),
    );
    await act(async () => copyValue?.click());
    expect(mocks.copy).toHaveBeenCalledWith('nibleaf-verify=token');
    expect(mocks.toast.success).toHaveBeenCalledWith('settings.domain.dns.copied');
  });
});

describe('adding a domain', () => {
  it('connects the bare hostname when a full web address is pasted', async () => {
    await render();
    await typeDomain('  HTTPS://Docs.Example.com/help/ ');
    await submit();
    expect(mocks.add.mutate).toHaveBeenCalledWith({ domain: 'docs.example.com' }, expect.any(Object));
  });

  it('explains what to enter instead of sending something that is not a domain', async () => {
    await render();
    // Two words are never joined into a different domain.
    await typeDomain('docs example.com');
    await submit();
    expect(mocks.add.mutate).not.toHaveBeenCalled();
    expect(container.querySelector('#custom-domain-error')?.textContent).toBe('settings.domain.error.invalid');
    expect(container.querySelector('#custom-domain')?.getAttribute('aria-invalid')).toBe('true');
  });

  const failAdd = async (error: unknown) => {
    await render();
    await typeDomain('docs.example.com');
    await submit();
    const [, options] = mocks.add.mutate.mock.calls[0] as [unknown, { onError: (error: unknown) => void }];
    await act(async () => options.onError(error));
    return container.querySelector('[role="alert"]')?.textContent;
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
    const message = await failAdd(
      new ApiResponseError('x', 409, 'domain:already_connected', undefined, undefined, undefined, undefined, { scope: 'other_workspace' }),
    );
    expect(message).toBe('settings.domain.error.connectedElsewhere');
  });

  it('falls back to "another workspace" if a same-workspace answer has no name', async () => {
    expect(
      await failAdd(
        new ApiResponseError('x', 409, 'domain:already_connected', undefined, undefined, undefined, undefined, { scope: 'same_workspace' }),
      ),
    ).toBe('settings.domain.error.connectedElsewhere');
  });

  it('says the domain is already on this site', async () => {
    expect(await failAdd(new ApiResponseError('x', 409, 'domain:already_added'))).toBe('settings.domain.error.alreadyAdded');
  });

  it('warns that a root domain may not accept a CNAME record', async () => {
    await render();
    await typeDomain('example.com');
    expect(container.querySelector('#custom-domain-apex')?.textContent).toContain('settings.domain.apexHint');
  });
});

describe('removing a domain', () => {
  it('asks first, then removes it and confirms', async () => {
    mocks.confirm.mockResolvedValue(true);
    await render();
    const [row] = rows();
    if (!row) throw new Error('Expected a domain row');
    await act(async () => button(row, 'settings.domain.remove')?.click());
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    const [id, options] = mocks.remove.mutate.mock.calls[0] as [string, { onSuccess: () => void }];
    expect(id).toBe('domain-a');
    options.onSuccess();
    expect(mocks.toast.success).toHaveBeenCalledWith('settings.domain.toast.removed');
  });

  it('does nothing when the confirmation is cancelled', async () => {
    mocks.confirm.mockResolvedValue(false);
    await render();
    const [row] = rows();
    if (!row) throw new Error('Expected a domain row');
    await act(async () => button(row, 'settings.domain.remove')?.click());
    expect(mocks.remove.mutate).not.toHaveBeenCalled();
  });
});
