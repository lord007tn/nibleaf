// @vitest-environment jsdom
import { type AnchorHTMLAttributes, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigDirtyProvider } from '@/components/project-settings/shared';
import type { Project, ReaderAccessData } from '@/hooks/api';
import { ReaderAccessSettings } from './reader-access-settings';

const MUTATIONS = [
  'setMode',
  'inviteOne',
  'inviteMany',
  'resend',
  'revoke',
  'saveDomains',
  'requests',
  'approve',
  'decline',
  'createAudience',
  'deleteAudience',
  'saveJwt',
  'testJwt',
  'emergency',
] as const;
type MutationMock = { mutateAsync: ReturnType<typeof vi.fn>; isPending: boolean; variables: string | undefined };
const mutation = (): MutationMock => ({ mutateAsync: vi.fn(), isPending: false, variables: undefined });
const mocks = vi.hoisted(() => ({
  data: undefined as unknown,
  pages: { data: [] as unknown, isPending: false, isError: false, isFetching: false, refetch: vi.fn() },
  status: 'admin' as 'admin' | 'notAdmin' | 'pending',
  edit: 'edit',
  toast: { success: vi.fn(), error: vi.fn() },
  m: {} as Record<(typeof MUTATIONS)[number], MutationMock>,
}));
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, variables?: Record<string, unknown>) => (variables ? `${key} ${JSON.stringify(variables)}` : key),
  translateFn: (key: string) => key,
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/hooks/api/errors', () => ({ friendlyErrorMessage: (_t: unknown, _error: unknown, key: string) => key }));
vi.mock('@/lib/bidi', () => ({ isolate: (value: string) => value }));
vi.mock('@/lib/format', () => ({
  useFormatters: () => ({
    date: () => 'Nov 9',
    dateTime: () => 'Nov 9, 10:00',
    relativeTime: () => '3h ago',
    count: (n: number) => ({ count: String(n) }),
  }),
}));
vi.mock('@/hooks/use-project-admin-status', () => ({ useProjectAdminStatus: () => ({ status: mocks.status, edit: mocks.edit }) }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode }) => (
    <a className={className} href="/settings?section=members">
      {children}
    </a>
  ),
  useBlocker: () => undefined,
}));
// Class per mutation (api/hooks.ts): every write is server-confirmed; none is optimistic.
vi.mock('../api/hooks', () => ({
  useReaderAccessSettings: () => ({ data: mocks.data, isPending: false, isError: false, isFetching: false, refetch: vi.fn() }),
  useAudiencePages: () => mocks.pages,
  useSetAccessMode: () => mocks.m.setMode,
  useInviteOneReader: () => mocks.m.inviteOne,
  useInviteManyReaders: () => mocks.m.inviteMany,
  useResendInvitation: () => mocks.m.resend,
  useRevokeReaderAccess: () => mocks.m.revoke,
  useSaveEmailDomains: () => mocks.m.saveDomains,
  useSetAccessRequests: () => mocks.m.requests,
  useApproveRequest: () => mocks.m.approve,
  useDeclineRequest: () => mocks.m.decline,
  useCreateAudience: () => mocks.m.createAudience,
  useDeleteAudience: () => mocks.m.deleteAudience,
  useSaveJwtConfig: () => mocks.m.saveJwt,
  useTestJwt: () => mocks.m.testJwt,
  useEmergencyRevoke: () => mocks.m.emergency,
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const JWT = {
  enabled: true,
  issuer: 'https://portal.example.com',
  audience: 'nibleaf-docs',
  jwksUrl: 'https://portal.example.com/.well-known/jwks.json',
  publicJwks: null,
  groupsClaim: 'groups',
  claimMapping: {},
  sessionTtlMinutes: 480,
  maxTokenAgeSeconds: 300,
  clockToleranceSecs: 30,
};

const readerData = (overrides: Partial<ReaderAccessData> = {}): ReaderAccessData => ({
  accessMode: 'READERS',
  readerEmailDomains: [],
  readerAccessRequests: false,
  accessRequests: [],
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
  jwt: { ...JWT },
  audit: [],
  ...overrides,
});

let container: HTMLDivElement;
let root: Root;
let dirty: Set<string>;
const render = () =>
  act(async () =>
    root.render(
      <ConfigDirtyProvider report={(id, changed) => (changed ? dirty.add(id) : dirty.delete(id))}>
        <ReaderAccessSettings project={{ id: 'site-1' } as Project} />
      </ConfigDirtyProvider>,
    ),
  );
/** A refetch: the query hands back a new object (here with whatever changed on the server). */
const refetch = (data: ReaderAccessData) => {
  mocks.data = data;
  return render();
};

beforeEach(() => {
  mocks.data = readerData();
  mocks.pages = { data: [], isPending: false, isError: false, isFetching: false, refetch: vi.fn() };
  mocks.status = 'admin';
  mocks.edit = 'edit';
  mocks.m = Object.fromEntries(MUTATIONS.map((name) => [name, mutation()])) as typeof mocks.m;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  dirty = new Set();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

const buttons = (scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>('button')];
const button = (scope: ParentNode, text: string) => buttons(scope).find((b) => b.textContent?.trim().startsWith(text));
const control = (label: string) => {
  const labelEl = [...container.querySelectorAll('label')].find((el) => el.textContent === label);
  const found = labelEl ? document.getElementById(labelEl.htmlFor) : null;
  if (!(found instanceof HTMLInputElement || found instanceof HTMLTextAreaElement || found instanceof HTMLButtonElement)) {
    throw new Error(`No control for ${label}`);
  }
  return found;
};
const field = (label: string) => {
  const found = control(label);
  if (found instanceof HTMLButtonElement) throw new Error(`${label} is not a text field`);
  return found;
};
const type = (el: HTMLInputElement | HTMLTextAreaElement, text: string) =>
  act(async () => {
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const blur = (el: HTMLElement) =>
  act(async () => {
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    el.dispatchEvent(new FocusEvent('blur'));
  });
const submitFormOf = (el: HTMLElement) =>
  act(async () => {
    el.closest('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
const errorOf = (el: HTMLElement) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id))
    .find((node) => node?.dataset.slot === 'settings-row-error')?.textContent;
const radios = () => [...container.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
const region = () => container.querySelector('[data-slot="save-region"]');
const saveBar = () => act(async () => button(region() ?? document, 'common.save')?.click());
const dialog = () => document.querySelector<HTMLElement>('[data-slot="action-dialog"]');
const confirmDialog = () =>
  act(async () =>
    buttons(dialog() ?? document)
      .find((b) => b.type === 'submit')
      ?.click(),
  );
const rows = () => [...container.querySelectorAll<HTMLElement>('[data-slot="data-list-item"]')];
const chooseAction = async (scope: ParentNode, text: string) => {
  const trigger = buttons(scope).find((b) => b.getAttribute('aria-label')?.startsWith('settings.visibility.actionsFor'));
  if (!trigger) throw new Error('Expected the row actions');
  await act(async () => trigger.click());
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((el) => el.textContent?.startsWith(text));
  if (!item) throw new Error(`Expected the ${text} action`);
  await act(async () => item.click());
};
const openAdvanced = () => act(async () => button(container, 'settings.visibility.advanced.title')?.click());
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
/** The reader controls (invitations, list, requests, advanced access) are mounted and on screen. */
const readerControlsShown = () => {
  const controls = container.querySelector('[data-reader-controls]');
  return Boolean(controls) && !controls?.classList.contains('hidden');
};
const enabledSwitch = () => {
  const label = [...container.querySelectorAll<HTMLElement>('[id]')].find((el) => el.textContent === 'settings.authentication.reader.jwtEnable');
  const toggle = label ? container.querySelector<HTMLElement>(`[role="switch"][aria-labelledby~="${label.id}"]`) : null;
  if (!toggle) throw new Error('Expected the JWT switch');
  return toggle;
};

describe('who can read the site', () => {
  it('offers three plain choices as radio buttons under one page heading, with nothing to save at first', async () => {
    mocks.data = readerData({ accessMode: 'PUBLIC' });
    await render();
    expect(container.querySelector('h1')?.textContent).toBe('settings.authentication');
    expect(radios().map((radio) => [radio.value, radio.checked])).toEqual([
      ['PUBLIC', true],
      ['WORKSPACE', false],
      ['READERS', false],
    ]);
    expect(container.querySelector('fieldset legend')?.textContent).toBe('settings.visibility.title');
    expect(container.textContent).toContain('settings.visibility.current');
    expect(button(container, 'settings.visibility.save')).toBeUndefined();
    // Reader controls only show for an Invited readers site.
    expect(container.textContent).not.toContain('settings.visibility.readersHeading');
  });

  it('saves a new choice only after a confirmation that says what changes for readers', async () => {
    mocks.data = readerData({ accessMode: 'PUBLIC' });
    mocks.m.setMode.mutateAsync.mockResolvedValue(undefined);
    await render();
    await act(async () => radios()[2]?.click());
    expect(dirty.size).toBeGreaterThan(0);
    await act(async () => button(container, 'settings.visibility.save')?.click());
    expect(dialog()?.textContent).toContain('settings.visibility.confirmPrivateTitle');
    // Making a site private is not the exposing change, so its confirmation isn't styled as destructive.
    expect(buttons(dialog() ?? document).find((b) => b.type === 'submit')?.className).not.toContain('bg-destructive');
    await act(async () => button(dialog() ?? document, 'common.cancel')?.click());
    expect(mocks.m.setMode.mutateAsync).not.toHaveBeenCalled();

    await act(async () => button(container, 'settings.visibility.save')?.click());
    await confirmDialog();
    expect(mocks.m.setMode.mutateAsync).toHaveBeenCalledWith({ mode: 'READERS' });
    expect(mocks.toast.success).toHaveBeenCalledWith('settings.visibility.saved');
  });

  it('keeps the dialog open with a plain-language error when the change fails', async () => {
    mocks.data = readerData({ accessMode: 'PUBLIC' });
    mocks.m.setMode.mutateAsync.mockRejectedValue(new Error('boom'));
    await render();
    await act(async () => radios()[1]?.click());
    await act(async () => button(container, 'settings.visibility.save')?.click());
    await confirmDialog();
    expect(dialog()?.querySelector('[data-slot="action-dialog-error"]')?.textContent).toBe('settings.saveError');
    expect(radios()[1]?.checked).toBe(true);
  });

  // Regression (operations/ui-overhaul.md §4.1): a useEffect copied the server's
  // mode into local state on every refetch, so an unsaved choice snapped back.
  it('keeps an unsaved choice when the reader-access data is refetched', async () => {
    mocks.data = readerData({ accessMode: 'PUBLIC' });
    await render();
    await act(async () => radios()[2]?.click());
    await refetch(readerData({ accessMode: 'PUBLIC', readerEmailDomains: ['acme.com'] }));
    expect(radios()[2]?.checked).toBe(true);
    expect(button(container, 'settings.visibility.save')).toBeDefined();
    expect(dirty.size).toBeGreaterThan(0);
  });

  it('points a Team only site at Members', async () => {
    mocks.data = readerData({ accessMode: 'WORKSPACE' });
    await render();
    expect(container.textContent).toContain('settings.visibility.teamNote');
    expect(container.querySelector('a')?.textContent).toBe('settings.visibility.openMembers');
  });
});

describe('inviting readers', () => {
  it('invites one reader to the whole site and offers the link to share', async () => {
    mocks.m.inviteOne.mutateAsync.mockResolvedValue({ activationUrl: 'https://docs.example.com/api/public/reader-access/activate?token=t' });
    await render();
    const emails = field('settings.visibility.invite.label');
    await type(emails, ' Lee@Example.com ');
    await submitFormOf(emails);
    expect(mocks.m.inviteOne.mutateAsync).toHaveBeenCalledWith({ email: 'lee@example.com', audienceIds: [] });
    expect(container.querySelector<HTMLInputElement>('input[readonly]')?.value).toContain('activate?token=t');
    expect(emails.value).toBe('');
  });

  // Council #445: the add form reset itself after every send, wiping what was typed meanwhile.
  it('keeps addresses typed while an invitation is sent, and sends one at a time', async () => {
    const pending = deferred<{ activationUrl: string }>();
    mocks.m.inviteOne.mutateAsync.mockReturnValueOnce(pending.promise);
    await render();
    const emails = field('settings.visibility.invite.label');
    await type(emails, 'lee@example.com');
    await submitFormOf(emails);
    await type(emails, 'kim@example.com');
    // Enter again while the first is in flight sends nothing more.
    await submitFormOf(emails);
    expect(mocks.m.inviteOne.mutateAsync).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ activationUrl: 'https://docs.example.com/activate?token=t' }));
    expect(emails.value).toBe('kim@example.com');
    expect(dirty.size).toBeGreaterThan(0);
    expect(mocks.toast.success).toHaveBeenCalledWith('settings.visibility.invite.sentOne {"email":"lee@example.com"}');
  });

  it('invites several readers at once and refuses a list with a typo, under the field', async () => {
    mocks.m.inviteMany.mutateAsync.mockResolvedValue({ invited: 2, readers: [] });
    await render();
    const emails = field('settings.visibility.invite.label');
    await type(emails, 'a@example.com, b@example');
    await submitFormOf(emails);
    expect(mocks.m.inviteMany.mutateAsync).not.toHaveBeenCalled();
    expect(errorOf(emails)).toContain('b@example');
    expect(emails.getAttribute('aria-invalid')).toBe('true');
    await type(emails, 'a@example.com\nb@example.com');
    await submitFormOf(emails);
    expect(mocks.m.inviteMany.mutateAsync).toHaveBeenCalledWith({ emails: ['a@example.com', 'b@example.com'], audienceIds: [] });
  });

  it('saves allowed domains from the save bar and rejects ones that are not domains', async () => {
    mocks.m.saveDomains.mutateAsync.mockResolvedValue({ domains: ['partner.example'] });
    await render();
    const domains = field('settings.visibility.domains.label');
    await type(domains, 'not a domain');
    await saveBar();
    expect(mocks.m.saveDomains.mutateAsync).not.toHaveBeenCalled();
    expect(errorOf(domains)).toContain('settings.visibility.domains.invalid');
    await type(domains, '@Partner.Example');
    await saveBar();
    expect(mocks.m.saveDomains.mutateAsync).toHaveBeenCalledWith({ domains: ['partner.example'] });
    expect(domains.value).toBe('partner.example');
    expect(region()).toBeNull();
  });

  it('refuses a public email provider as an allowed domain, inline, without saving', async () => {
    await render();
    const domains = field('settings.visibility.domains.label');
    await type(domains, 'acme.com, Gmail.com');
    await saveBar();
    expect(mocks.m.saveDomains.mutateAsync).not.toHaveBeenCalled();
    expect(errorOf(domains)).toBe('settings.visibility.domains.publicProvider {"domain":"gmail.com"}');
    expect(domains.getAttribute('aria-invalid')).toBe('true');
  });
});

describe('access requests', () => {
  it('turns access requests on, and approves or declines a request in one click', async () => {
    mocks.m.requests.mutateAsync.mockResolvedValue(undefined);
    await render();
    expect(container.textContent).not.toContain('settings.visibility.requests.empty');
    await act(async () => (control('settings.visibility.requests.toggle') as HTMLButtonElement).click());
    expect(mocks.m.requests.mutateAsync).toHaveBeenCalledWith({ enabled: true });
    expect(container.textContent).toContain('common.saved');

    await refetch(
      readerData({
        readerAccessRequests: true,
        accessRequests: [{ id: 'q1', email: 'kim@example.com', name: 'Kim', note: 'For the pilot', createdAt: '2026-11-09T00:00:00.000Z' }],
      }),
    );
    expect(container.textContent).toContain('For the pilot');
    await act(async () => button(container, 'settings.visibility.requests.approve')?.click());
    expect(mocks.m.approve.mutateAsync).toHaveBeenCalledWith('q1');
    await act(async () => button(container, 'settings.visibility.requests.decline')?.click());
    expect(mocks.m.decline.mutateAsync).toHaveBeenCalledWith('q1');
    // Each button names the person it answers.
    expect(button(container, 'settings.visibility.requests.approve')?.textContent).toContain('Kim');
  });

  it('says there are none while requests are on and nobody has asked', async () => {
    mocks.data = readerData({ readerAccessRequests: true });
    await render();
    expect(container.textContent).toContain('settings.visibility.requests.empty');
  });
});

describe('the reader list', () => {
  const readerRows = () => rows().filter((row) => row.closest('[aria-label="settings.visibility.list.title"]'));

  it('lists each reader with status and dates, and offers actions only while they have access', async () => {
    mocks.m.resend.mutateAsync.mockResolvedValue(undefined);
    await render();
    const [invited, revoked] = readerRows();
    expect(invited?.textContent).toContain('settings.visibility.status.invited');
    expect(invited?.textContent).toContain('settings.visibility.list.neverSeen');
    expect(revoked?.textContent).toContain('settings.authentication.reader.status.revoked');
    expect(revoked?.textContent).toContain('settings.visibility.list.revokedOn');
    expect(revoked?.querySelector('button')).toBeNull();
    if (!invited) throw new Error('Expected the invited reader');
    // The menu is named after the reader.
    expect(buttons(invited)[0]?.getAttribute('aria-label')).toBe('settings.visibility.actionsFor {"name":"ana@example.com"}');
    await chooseAction(invited, 'settings.visibility.list.resend');
    expect(mocks.m.resend.mutateAsync).toHaveBeenCalledWith('r-invited');
  });

  it('removes a reader after asking, and says so', async () => {
    mocks.m.revoke.mutateAsync.mockResolvedValue(undefined);
    await render();
    const [invited] = readerRows();
    if (!invited) throw new Error('Expected the invited reader');
    await chooseAction(invited, 'settings.authentication.reader.revoke');
    expect(dialog()?.textContent).toContain('settings.authentication.reader.revokeConfirm {"name":"ana@example.com"}');
    await confirmDialog();
    expect(mocks.m.revoke.mutateAsync).toHaveBeenCalledWith('r-invited');
    expect(mocks.toast.success).toHaveBeenCalledWith('settings.visibility.list.revoked {"name":"ana@example.com"}');
  });

  it('shows an empty state when nobody has been invited', async () => {
    mocks.data = readerData({ readers: [] });
    await render();
    expect(container.textContent).toContain('settings.visibility.list.empty');
  });
});

describe('advanced access', () => {
  // Regression (operations/ui-overhaul.md §4.1): a useEffect copied data.jwt into
  // seven useState on every refetch, so creating an audience wiped JWT edits.
  it('keeps in-progress JWT edits when creating an audience refetches reader access', async () => {
    mocks.m.createAudience.mutateAsync.mockResolvedValue({ id: 'aud-2' });
    await render();
    await openAdvanced();
    const issuer = field('settings.visibility.jwt.issuer');
    await type(issuer, 'https://login.acme.example');

    const name = field('settings.visibility.audiences.name');
    await type(name, 'Customers');
    await submitFormOf(name);
    expect(mocks.m.createAudience.mutateAsync).toHaveBeenCalledWith({ name: 'Customers', pageIds: [] });
    // The mutation's invalidation refetches: a new object, the same JWT settings, one more audience.
    await refetch(
      readerData({ jwt: { ...JWT }, audiences: [{ id: 'aud-2', name: 'Customers', grants: [{ pageId: null }], _count: { readers: 0 } }] }),
    );

    expect(field('settings.visibility.jwt.issuer').value).toBe('https://login.acme.example');
    expect(region()).not.toBeNull();
    expect(dirty.size).toBeGreaterThan(0);
  });

  // Council #445: the create form reset itself after every create, wiping what was typed meanwhile.
  it('keeps an audience name typed while another audience is created', async () => {
    const pending = deferred<{ id: string }>();
    mocks.m.createAudience.mutateAsync.mockReturnValueOnce(pending.promise);
    await render();
    await openAdvanced();
    const name = field('settings.visibility.audiences.name');
    await type(name, 'Customers');
    await submitFormOf(name);
    await type(name, 'Partners');
    await submitFormOf(name);
    expect(mocks.m.createAudience.mutateAsync).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ id: 'aud-2' }));
    expect(name.value).toBe('Partners');
    expect(dirty.size).toBeGreaterThan(0);
  });

  // Council #445: the reader controls were mounted only for Invited readers, so
  // a refetch that changed visibility unmounted them with their drafts.
  it('keeps unsaved JWT edits and their conflicts when another admin changes visibility', async () => {
    await render();
    await openAdvanced();
    await type(field('settings.visibility.jwt.issuer'), 'https://login.acme.example');
    await refetch(readerData({ accessMode: 'WORKSPACE', jwt: { ...JWT, issuer: 'https://sso.acme.example' } }));

    expect(readerControlsShown()).toBe(true);
    expect(container.textContent).toContain('settings.visibility.readersKept');
    expect(field('settings.visibility.jwt.issuer').value).toBe('https://login.acme.example');
    expect(container.textContent).toContain('forms.changedElsewhere');
    expect(region()).not.toBeNull();
    expect(dirty.size).toBeGreaterThan(0);

    // Once nothing is unsaved, the controls of a site that no longer invites readers go away.
    await act(async () => button(region() ?? document, 'forms.discard')?.click());
    expect(readerControlsShown()).toBe(false);
    expect(dirty.size).toBe(0);
  });

  it('keeps the reader controls through a pending save when visibility changes', async () => {
    const pending = deferred<undefined>();
    mocks.m.saveJwt.mutateAsync.mockReturnValueOnce(pending.promise);
    await render();
    await openAdvanced();
    // The groups claim doesn't change who can sign in, so it saves without asking.
    await type(field('settings.visibility.jwt.groupsClaim'), 'teams');
    await saveBar();
    expect(mocks.m.saveJwt.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ groupsClaim: 'teams' }));
    await refetch(readerData({ accessMode: 'PUBLIC' }));
    expect(readerControlsShown()).toBe(true);
    expect(field('settings.visibility.jwt.groupsClaim').value).toBe('teams');

    await act(async () => pending.resolve(undefined));
    expect(region()).toBeNull();
    expect(readerControlsShown()).toBe(false);
  });

  it('keeps unsaved reader settings when the admin makes the site public', async () => {
    mocks.m.setMode.mutateAsync.mockResolvedValue(undefined);
    await render();
    const domains = field('settings.visibility.domains.label');
    await type(domains, 'partner.example');
    await act(async () => radios()[0]?.click());
    await act(async () => button(container, 'settings.visibility.save')?.click());
    await confirmDialog();
    expect(mocks.m.setMode.mutateAsync).toHaveBeenCalledWith({ mode: 'PUBLIC' });
    await refetch(readerData({ accessMode: 'PUBLIC' }));
    expect(readerControlsShown()).toBe(true);
    expect(field('settings.visibility.domains.label').value).toBe('partner.example');
    expect(region()).not.toBeNull();
  });

  // Council #445: JWT access changes saved straight through the save bar.
  it('asks before turning the handoff off, and says sessions run on', async () => {
    mocks.m.saveJwt.mutateAsync.mockResolvedValue(undefined);
    await render();
    await openAdvanced();
    await act(async () => enabledSwitch().click());
    await saveBar();
    expect(mocks.m.saveJwt.mutateAsync).not.toHaveBeenCalled();
    expect(dialog()?.textContent).toContain('settings.visibility.jwt.confirm.title');
    expect(dialog()?.textContent).toContain('settings.visibility.jwt.impact.disable');
    expect(buttons(dialog() ?? document).find((b) => b.type === 'submit')?.className).toContain('bg-destructive');

    // Cancel: nothing is saved and the edit stays.
    await act(async () => button(dialog() ?? document, 'common.cancel')?.click());
    expect(mocks.m.saveJwt.mutateAsync).not.toHaveBeenCalled();
    expect(region()).not.toBeNull();

    await saveBar();
    await confirmDialog();
    expect(mocks.m.saveJwt.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    expect(region()).toBeNull();
  });

  // Council #456: the save bar showed "Saving…" behind the confirmation.
  it('keeps the save bar idle while it asks, and saves only once confirmed', async () => {
    const pending = deferred<undefined>();
    mocks.m.saveJwt.mutateAsync.mockReturnValueOnce(pending.promise);
    await render();
    await openAdvanced();
    await type(field('settings.visibility.jwt.audience'), 'docs-v2');
    await saveBar();
    expect(dialog()?.textContent).toContain('settings.visibility.jwt.impact.audience');
    // Its Save button is not busy: nothing is being saved yet.
    expect(region()?.querySelector('[aria-busy="true"]')).toBeNull();
    expect(mocks.m.saveJwt.mutateAsync).not.toHaveBeenCalled();

    await confirmDialog();
    expect(mocks.m.saveJwt.mutateAsync).toHaveBeenCalledOnce();
    expect(region()?.querySelector('[aria-busy="true"]')).not.toBeNull();
    await act(async () => pending.resolve(undefined));
    expect(region()).toBeNull();
    expect(mocks.toast.success).toHaveBeenCalledWith('settings.authentication.reader.jwtSaved');
  });

  it('saves the other reader settings while the JWT change waits for an answer', async () => {
    mocks.m.saveDomains.mutateAsync.mockResolvedValue({ domains: ['partner.example'] });
    await render();
    await openAdvanced();
    await type(field('settings.visibility.jwt.issuer'), 'https://login.acme.example');
    await type(field('settings.visibility.domains.label'), 'partner.example');
    await saveBar();
    expect(mocks.m.saveDomains.mutateAsync).toHaveBeenCalledWith({ domains: ['partner.example'] });
    expect(dialog()?.textContent).toContain('settings.visibility.jwt.impact.issuer');
    // Nothing claims "Saved" while the JWT change is still unanswered.
    expect(region()?.textContent).not.toContain('common.saved');
  });

  it('names a new issuer and key set in the confirmation, and keeps a failure in the dialog', async () => {
    mocks.m.saveJwt.mutateAsync.mockRejectedValueOnce(new Error('boom'));
    await render();
    await openAdvanced();
    await type(field('settings.visibility.jwt.issuer'), 'https://login.acme.example');
    await type(field('settings.visibility.jwt.jwksUrl'), 'https://login.acme.example/jwks.json');
    await saveBar();
    const text = dialog()?.textContent ?? '';
    expect(text).toContain('settings.visibility.jwt.impact.issuer');
    expect(text).toContain('settings.visibility.jwt.impact.keys');
    expect(text).toContain('settings.visibility.jwt.impact.sessions');
    expect(text).not.toContain('settings.visibility.jwt.impact.audience');
    await confirmDialog();
    expect(dialog()?.querySelector('[data-slot="action-dialog-error"]')?.textContent).toBe('settings.saveError');
    expect(mocks.toast.error).not.toHaveBeenCalled();
    expect(field('settings.visibility.jwt.issuer').value).toBe('https://login.acme.example');
  });

  it('masks a pasted test token and keeps it out of browser autofill', async () => {
    await render();
    await openAdvanced();
    const token = field('settings.authentication.reader.jwtTest');
    expect(token.type).toBe('text');
    expect(token.className).toContain('[-webkit-text-security:disc]');
    expect(token.getAttribute('autocomplete')).toBe('off');
    expect(token.getAttribute('data-1p-ignore')).toBe('true');
    expect(token.getAttribute('data-lpignore')).toBe('true');
    expect(token.getAttribute('name')).toBe('reader-jwt-test-token');
  });

  it('takes a server change to a JWT field nobody edited without touching an edited one', async () => {
    await render();
    await openAdvanced();
    await type(field('settings.visibility.jwt.issuer'), 'https://login.acme.example');
    await refetch(readerData({ jwt: { ...JWT, audience: 'docs-v2' } }));
    expect(field('settings.visibility.jwt.issuer').value).toBe('https://login.acme.example');
    expect(field('settings.visibility.jwt.audience').value).toBe('docs-v2');
  });

  it('saves the JWT settings from the save bar with the named session policy', async () => {
    mocks.m.saveJwt.mutateAsync.mockResolvedValue(undefined);
    await render();
    await openAdvanced();
    await type(field('settings.visibility.jwt.audience'), 'docs-v2');
    await saveBar();
    // A new audience refuses tokens made for the old one, so it asks first.
    expect(dialog()?.textContent).toContain('settings.visibility.jwt.impact.audience');
    await confirmDialog();
    expect(mocks.m.saveJwt.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ audience: 'docs-v2', jwksUrl: JWT.jwksUrl, publicJwks: null, sessionTtlMinutes: 480, maxTokenAgeSeconds: 300 }),
    );
    expect(region()).toBeNull();
  });

  it('labels every JWT input and shows a problem after the field is left', async () => {
    await render();
    await openAdvanced();
    for (const label of [
      'settings.visibility.jwt.issuer',
      'settings.visibility.jwt.audience',
      'settings.visibility.jwt.jwksUrl',
      'settings.visibility.jwt.publicJwks',
      'settings.visibility.jwt.groupsClaim',
      'settings.visibility.jwt.claimMapping',
    ]) {
      expect(field(label)).toBeTruthy();
    }
    const mapping = field('settings.visibility.jwt.claimMapping');
    await type(mapping, '{oops');
    expect(mapping.getAttribute('aria-invalid')).toBeNull();
    await blur(mapping);
    expect(errorOf(mapping)).toBe('settings.authentication.reader.jsonError');
  });

  it('puts a value the server schema refuses on its field, not in a toast', async () => {
    await render();
    await openAdvanced();
    await type(field('settings.visibility.jwt.jwksUrl'), '');
    await type(field('settings.visibility.jwt.publicJwks'), '{"keys": [{"kty": "oct", "k": "secret"}]}');
    await saveBar();
    expect(mocks.m.saveJwt.mutateAsync).not.toHaveBeenCalled();
    expect(mocks.toast.error).not.toHaveBeenCalled();
    const keys = field('settings.visibility.jwt.publicJwks');
    expect(errorOf(keys)).toBe('settings.visibility.jwt.error.invalid');
    expect(document.activeElement).toBe(keys);
  });

  it('needs one key source and says so on the JWKS URL field', async () => {
    await render();
    await openAdvanced();
    await type(field('settings.visibility.jwt.jwksUrl'), '');
    await saveBar();
    expect(mocks.m.saveJwt.mutateAsync).not.toHaveBeenCalled();
    expect(errorOf(field('settings.visibility.jwt.jwksUrl'))).toBe('settings.visibility.jwt.error.keySource');
  });

  it('says when the pages could not be loaded and retries', async () => {
    mocks.pages = { data: undefined, isPending: false, isError: true, isFetching: false, refetch: vi.fn() };
    await render();
    await openAdvanced();
    expect(container.textContent).toContain('settings.visibility.audiences.pagesError');
    await act(async () => button(container, 'common.retry')?.click());
    expect(mocks.pages.refetch).toHaveBeenCalled();
  });

  it('runs the emergency revocation from a confirmation', async () => {
    mocks.m.emergency.mutateAsync.mockResolvedValue(undefined);
    mocks.data = readerData({ audit: [{ id: 'e1', action: 'READER_REVOKED', createdAt: '2026-11-09T10:00:00.000Z' }] });
    await render();
    await openAdvanced();
    expect(container.textContent).toContain('settings.authentication.reader.audit.action.readerRevoked');
    await act(async () => button(container, 'settings.authentication.reader.emergencyAction')?.click());
    expect(dialog()?.textContent).toContain('settings.authentication.reader.emergencyConfirm');
    await confirmDialog();
    expect(mocks.m.emergency.mutateAsync).toHaveBeenCalled();
    expect(mocks.toast.success).toHaveBeenCalledWith('settings.authentication.reader.emergencySuccess');
  });
});

describe('access', () => {
  it('tells non-admins once why there is nothing to change, without an error', async () => {
    mocks.status = 'notAdmin';
    mocks.data = undefined;
    await render();
    expect(container.querySelectorAll('[data-slot="callout"]')).toHaveLength(1);
    expect(container.textContent).toContain('settings.permissions.body');
    expect(radios()).toHaveLength(0);
  });

  it('words the note for Viewers', async () => {
    mocks.status = 'notAdmin';
    mocks.edit = 'viewOnly';
    await render();
    expect(container.textContent).toContain('settings.permissions.viewerBody');
  });

  it('locks the controls without a reason while access is unknown', async () => {
    mocks.status = 'pending';
    await render();
    expect(container.querySelector('[data-slot="callout"]')).toBeNull();
    expect(container.querySelector('fieldset')?.disabled).toBe(true);
    expect(container.querySelector('fieldset')?.getAttribute('aria-describedby')).toBeNull();
    expect(field('settings.visibility.invite.label').disabled).toBe(true);
  });
});
