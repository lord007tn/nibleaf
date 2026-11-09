// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReaderAccessData } from '@/hooks/api';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  inviteOne: vi.fn(),
  inviteMany: vi.fn(),
  resend: vi.fn(),
  revoke: vi.fn(),
  saveDomains: vi.fn(),
}));

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.mock('@nibleaf/i18n/react', () => ({
  useLocale: () => ({
    locale: 'en',
    t: (key: string, variables?: Record<string, unknown>) => (variables ? `${key} ${JSON.stringify(variables)}` : key),
  }),
}));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/api', () => {
  const mutation = (fn: ReturnType<typeof vi.fn>) => ({ mutateAsync: fn, isPending: false, variables: undefined });
  return {
    friendlyErrorMessage: (_t: unknown, _error: unknown, key: string) => key,
    useInviteReader: () => mutation(mocks.inviteOne),
    useInviteReaders: () => mutation(mocks.inviteMany),
    useResendReaderInvitation: () => mutation(mocks.resend),
    useRevokeReader: () => mutation(mocks.revoke),
    useUpdateReaderEmailDomains: () => mutation(mocks.saveDomains),
  };
});
vi.mock('@/lib/format', () => ({ useFormatters: () => ({ date: () => 'Nov 9', relativeTime: () => '3h ago' }) }));

import { parseDomainList, parseEmailList, ReadersPanel } from './readers-panel';
import { VisibilityPicker, visibilityChangeCopy } from './visibility-picker';

const data = (overrides: Partial<ReaderAccessData> = {}): ReaderAccessData => ({
  accessMode: 'READERS',
  readerEmailDomains: [],
  readers: [
    {
      id: 'r-invited',
      email: 'ana@example.com',
      name: null,
      status: 'INVITED',
      createdAt: '2026-11-09T00:00:00.000Z',
      activatedAt: null,
      revokedAt: null,
      lastSeenAt: null,
      audiences: [],
      _count: { sessions: 0 },
    },
    {
      id: 'r-revoked',
      email: 'sam@example.com',
      name: 'Sam',
      status: 'REVOKED',
      createdAt: '2026-11-01T00:00:00.000Z',
      activatedAt: '2026-11-02T00:00:00.000Z',
      revokedAt: '2026-11-05T00:00:00.000Z',
      lastSeenAt: null,
      audiences: [],
      _count: { sessions: 0 },
    },
  ],
  audiences: [],
  jwt: null,
  audit: [],
  ...overrides,
});

describe('visibility settings', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const type = async (selector: string, value: string) => {
    const element = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
    if (!element) throw new Error(`no ${selector}`);
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    await act(async () => {
      Object.getOwnPropertyDescriptor(prototype, 'value')?.set?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const submit = async (selector: string) => {
    await act(async () => {
      container.querySelector<HTMLFormElement>(`form:has(${selector})`)?.requestSubmit();
    });
  };

  it('reads addresses and domains from comma, semicolon or newline separated text', () => {
    expect(parseEmailList(' Ana@Example.com,\nsam@example.com; ana@example.com ')).toEqual(['ana@example.com', 'sam@example.com']);
    expect(parseDomainList('@Partner.Example, b.example\nb.example')).toEqual(['partner.example', 'b.example']);
  });

  it('explains each change of visibility in its own words', () => {
    expect(visibilityChangeCopy('PUBLIC', 'READERS').title).toBe('settings.visibility.confirmPrivateTitle');
    expect(visibilityChangeCopy('PUBLIC', 'WORKSPACE').title).toBe('settings.visibility.confirmPrivateTitle');
    expect(visibilityChangeCopy('READERS', 'PUBLIC').title).toBe('settings.visibility.confirmPublicTitle');
    expect(visibilityChangeCopy('READERS', 'WORKSPACE').title).toBe('settings.visibility.confirmToTeamTitle');
    expect(visibilityChangeCopy('WORKSPACE', 'READERS').title).toBe('settings.visibility.confirmToReadersTitle');
  });

  it('offers three plain choices as radio buttons and saves only after confirmation', async () => {
    const onSave = vi.fn(async () => undefined);
    const onChange = vi.fn();
    const render = (value: 'PUBLIC' | 'WORKSPACE' | 'READERS') =>
      act(async () =>
        root.render(<VisibilityPicker current="PUBLIC" disabled={false} onChange={onChange} onSave={onSave} saving={false} value={value} />),
      );
    await render('PUBLIC');
    const radios = [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((radio) => [radio.value, radio.checked])).toEqual([
      ['PUBLIC', true],
      ['WORKSPACE', false],
      ['READERS', false],
    ]);
    expect(container.textContent).toContain('settings.visibility.current');
    // Nothing to save until a different choice is made.
    expect(container.textContent).not.toContain('settings.visibility.save');
    await act(async () => radios[2]?.click());
    expect(onChange).toHaveBeenCalledWith('READERS');

    await render('READERS');
    const save = [...container.querySelectorAll('button')].find((button) => button.textContent === 'settings.visibility.save');
    mocks.confirm.mockResolvedValueOnce(false);
    await act(async () => save?.click());
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'settings.visibility.confirmPrivateTitle', destructive: false }));
    expect(onSave).not.toHaveBeenCalled();
    mocks.confirm.mockResolvedValueOnce(true);
    await act(async () => save?.click());
    expect(onSave).toHaveBeenCalledWith('READERS');
  });

  it('invites one reader to the whole site and offers the link to share', async () => {
    mocks.inviteOne.mockResolvedValueOnce({ activationUrl: 'https://docs.example.com/api/public/reader-access/activate?token=t' });
    await act(async () => root.render(<ReadersPanel data={data()} disabled={false} projectId="site-1" />));
    await type('#reader-invite-emails', ' Lee@Example.com ');
    await submit('#reader-invite-emails');
    expect(mocks.inviteOne).toHaveBeenCalledWith({ email: 'lee@example.com', audienceIds: [] });
    expect(container.querySelector<HTMLInputElement>('input[readonly]')?.value).toContain('activate?token=t');
  });

  it('invites several readers at once and refuses a list with a typo', async () => {
    mocks.inviteMany.mockResolvedValueOnce({ invited: 2, readers: [] });
    await act(async () => root.render(<ReadersPanel data={data()} disabled={false} projectId="site-1" />));
    await type('#reader-invite-emails', 'a@example.com, b@example');
    await submit('#reader-invite-emails');
    expect(mocks.inviteMany).not.toHaveBeenCalled();
    expect(container.querySelector('#reader-invite-emails-error')?.textContent).toContain('b@example');
    expect(container.querySelector('#reader-invite-emails')?.getAttribute('aria-invalid')).toBe('true');
    await type('#reader-invite-emails', 'a@example.com\nb@example.com');
    await submit('#reader-invite-emails');
    expect(mocks.inviteMany).toHaveBeenCalledWith({ emails: ['a@example.com', 'b@example.com'], audienceIds: [] });
  });

  it('saves allowed domains and rejects ones that are not domains', async () => {
    mocks.saveDomains.mockResolvedValueOnce({ domains: ['partner.example'] });
    await act(async () => root.render(<ReadersPanel data={data()} disabled={false} projectId="site-1" />));
    await type('#reader-email-domains', 'not a domain');
    await submit('#reader-email-domains');
    expect(mocks.saveDomains).not.toHaveBeenCalled();
    expect(container.querySelector('#reader-email-domains-error')).not.toBeNull();
    await type('#reader-email-domains', '@Partner.Example');
    await submit('#reader-email-domains');
    expect(mocks.saveDomains).toHaveBeenCalledWith({ domains: ['partner.example'] });
  });

  it('refuses a public email provider as an allowed domain, inline, without saving', async () => {
    await act(async () => root.render(<ReadersPanel data={data()} disabled={false} projectId="site-1" />));
    await type('#reader-email-domains', 'acme.com, Gmail.com');
    await submit('#reader-email-domains');
    expect(mocks.saveDomains).not.toHaveBeenCalled();
    expect(container.querySelector('#reader-email-domains-error')?.textContent).toBe(
      'settings.visibility.domains.publicProvider {"domain":"gmail.com"}',
    );
    expect(container.querySelector('#reader-email-domains')?.getAttribute('aria-invalid')).toBe('true');
  });

  it('lists each reader with status and dates, and offers resend and revoke only while they have access', async () => {
    await act(async () => root.render(<ReadersPanel data={data()} disabled={false} projectId="site-1" />));
    const [invited, revoked] = [...container.querySelectorAll('li')];
    expect(invited?.textContent).toContain('settings.visibility.status.invited');
    expect(invited?.textContent).toContain('settings.visibility.list.neverSeen');
    expect(invited?.textContent).toContain('settings.visibility.list.resend');
    expect(revoked?.textContent).toContain('settings.authentication.reader.status.revoked');
    expect(revoked?.textContent).toContain('settings.visibility.list.revokedOn');
    expect(revoked?.querySelector('button')).toBeNull();
    const resend = [...(invited?.querySelectorAll('button') ?? [])].find((button) => button.textContent === 'settings.visibility.list.resend');
    await act(async () => resend?.click());
    expect(mocks.resend).toHaveBeenCalledWith('r-invited');
  });
});
