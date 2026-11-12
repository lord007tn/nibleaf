/** @vitest-environment jsdom */
import { computeAccessibleDescription, computeAccessibleName, getRole, isInaccessible } from 'dom-accessibility-api';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, PublishCheck } from '@/hooks/api/types';
import { PublishModal, reviewRows } from './publish-modal';

const { mutate, showError, preflight, refreshPreflight, retryMembers, domains } = vi.hoisted(() => ({
  domains: { data: [] as object[] },
  mutate: vi.fn(),
  showError: vi.fn(),
  preflight: {
    isFetching: false,
    role: 'admin',
    membersPending: false,
    membersError: false,
    membersMissing: false,
    membersFetching: false,
    sessionPending: false,
    issues: [] as Array<{ code: 'cycle'; message: string; sequence: string[]; rowIndexes: number[] }>,
    checks: [] as PublishCheck[],
    // undefined: the default, one edited page on a published site.
    changes: undefined as object[] | undefined,
    hasBaseline: true,
    upToDate: false,
  },
  refreshPreflight: vi.fn(),
  retryMembers: vi.fn(),
}));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('sonner', () => ({ toast: { error: showError } }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, search, ...props }: { to: string; params: { projectId: string }; search: Record<string, string>; children: ReactNode }) => (
    <a {...props} href={`${to.replace('$projectId', encodeURIComponent(params.projectId))}?${new URLSearchParams(search)}`} />
  ),
}));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: { user: { id: 'user-a' } }, isPending: preflight.sessionPending }) }));
const pendingChange = {
  id: 'page-a',
  title: 'Getting started',
  path: 'getting-started',
  languageCode: 'en',
  kind: 'PAGE',
  status: 'modified',
  fields: ['content'],
  additions: 1,
  deletions: 0,
  lines: [] as Array<{ type: 'added' | 'removed' | 'unchanged'; text: string; oldLine: number | null; newLine: number | null }>,
  truncated: false,
};
vi.mock('@/hooks/api', () => ({
  friendlyErrorMessage: (_t: unknown, _error: unknown, key: string) => key,
  useDomains: () => domains,
  usePublish: () => ({ isPending: false, mutate }),
  useProjectMembers: () => ({
    data: preflight.membersMissing ? undefined : { members: [{ user: { id: 'user-a' }, role: preflight.role }] },
    isPending: preflight.membersPending,
    isError: preflight.membersError,
    isFetching: preflight.membersFetching,
    refetch: retryMembers,
  }),
  usePendingChanges: () => ({
    // One edited page: publishing is only offered when there is something to publish.
    data: {
      changes: preflight.changes ?? [pendingChange],
      redirectIssues: preflight.issues,
      checks: preflight.checks,
      hasBaseline: preflight.hasBaseline,
      upToDate: preflight.upToDate,
      lastVersion: preflight.hasBaseline ? 3 : null,
      reviewedStateHash: 'reviewed-hash',
    },
    isPending: false,
    isFetching: preflight.isFetching,
    isError: false,
    refetch: refreshPreflight,
  }),
}));
vi.mock('@/lib/first-publish-activation', () => ({ readFirstPublishAttribution: () => null }));

const project = { id: 'project-a', name: 'Docs' } as Project;

describe('publish draft barrier', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    vi.clearAllMocks();
    preflight.isFetching = false;
    preflight.issues = [];
    preflight.checks = [];
    preflight.role = 'admin';
    preflight.membersPending = false;
    preflight.membersError = false;
    preflight.membersMissing = false;
    preflight.membersFetching = false;
    preflight.sessionPending = false;
    preflight.changes = undefined;
    preflight.hasBaseline = true;
    preflight.upToDate = false;
    domains.data = [];
    refreshPreflight.mockResolvedValue({ data: { redirectIssues: [], reviewedStateHash: 'reviewed-hash' }, isError: false });
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllEnvs();
  });

  it.each([
    { base: '', domains: [], expected: 'http://localhost:3000/sites/project-1' },
    { base: '*.docs.example.test.', domains: [], expected: 'https://docs.docs.example.test' },
    {
      base: 'docs.example.test',
      domains: [{ domain: 'docs.example.com', verified: true, isPrimary: true, dnsStatus: 'VERIFIED', sslStatus: 'PROVISIONING' }],
      expected: 'https://docs.docs.example.test',
    },
    {
      base: 'docs.example.test',
      domains: [{ domain: 'docs.example.com', verified: true, isPrimary: true, dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE' }],
      expected: 'https://docs.example.com',
    },
  ])('shows the same first-publish destination as Overview: $expected', async (fixture) => {
    vi.stubEnv('VITE_SITE_BASE_DOMAIN', fixture.base);
    domains.data = fixture.domains;
    preflight.hasBaseline = false;
    const site = { ...project, id: 'project-1', slug: 'docs', readyPublishes: 0 };
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={site} />));
    const addresses = [...document.querySelectorAll('[dir="ltr"]')].map((element) => element.textContent?.trim());
    expect(addresses).toContain(fixture.expected);
  });

  it.each([
    [{ dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE' }, true],
    // Ownership proven, but readers would get a browser error: name the default address.
    [{ dnsStatus: 'ERROR', sslStatus: 'PENDING' }, false],
    [{ dnsStatus: 'VERIFIED', sslStatus: 'PROVISIONING' }, false],
  ])('names the custom domain as the address only once readers can open it: %o', async (status, live) => {
    domains.data = [{ id: 'domain-1', domain: 'docs.example.com', verified: true, isPrimary: true, ...status }];
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    // The site address line, compared whole (not as a substring of the page).
    const addresses = [...document.querySelectorAll('[dir="ltr"]')].map((element) => element.textContent?.trim());
    // An address is always shown: the default one when the domain isn't live.
    expect(addresses.some((address) => address?.startsWith('http') || address?.startsWith('/'))).toBe(true);
    if (live) expect(addresses).toContain('https://docs.example.com');
    else expect(addresses).not.toContain('https://docs.example.com');
  });

  it('waits for the current draft before creating the deployment', async () => {
    let finishSaving!: () => void;
    const beforePublish = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSaving = resolve;
        }),
    );
    await act(async () =>
      root.render(<PublishModal beforePublish={beforePublish} onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />),
    );
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    if (!publish) throw new Error('Publish action was not rendered');
    await act(async () => publish.click());
    expect(beforePublish).toHaveBeenCalledOnce();
    expect(mutate).not.toHaveBeenCalled();
    expect(refreshPreflight).not.toHaveBeenCalled();
    await act(async () => finishSaving());
    expect(mutate).toHaveBeenCalledOnce();
    expect(refreshPreflight).toHaveBeenCalledOnce();
  });

  it('requires another review when the saved draft changed after the displayed review', async () => {
    refreshPreflight.mockResolvedValue({ data: { redirectIssues: [], reviewedStateHash: 'changed-hash' }, isError: false });
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    await act(async () => publish?.click());
    expect(mutate).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith('publish.reviewChanged');
  });

  const check = (overrides: Partial<PublishCheck>): PublishCheck => ({
    code: 'missing-alt',
    severity: 'warning',
    pageId: 'page-b',
    languageCode: 'en',
    title: 'Install guide',
    path: 'guides/install',
    detail: '/diagram.png',
    ...overrides,
  });
  const publishButton = () => {
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    if (!publish) throw new Error('Publish action was not rendered');
    return publish;
  };
  const isUnavailable = (button: HTMLButtonElement) => button.disabled || button.getAttribute('aria-disabled') === 'true';
  /** The disabled reason assistive tech reads (the button's last description). */
  const reasonOf = (button: HTMLButtonElement) => {
    const id = button.getAttribute('aria-describedby')?.split(' ').at(-1);
    return id ? document.getElementById(id)?.textContent : undefined;
  };

  it('says every check passed when there is nothing to fix', async () => {
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    const checks = document.querySelector('[data-testid="publish-checks"]');
    expect(checks?.textContent).toContain('publish.checks.allClear');
    expect(isUnavailable(publishButton())).toBe(false);
  });

  it('lists warnings by type with a summary and still publishes', async () => {
    preflight.checks = [
      check({}),
      check({ detail: '/screenshot.png' }),
      check({ code: 'untitled-page', pageId: 'page-c', title: 'Untitled', path: 'untitled', detail: '' }),
    ];
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    const checks = document.querySelector('[data-testid="publish-checks"]');
    expect(checks?.textContent).toContain('publish.checks.warningCount · publish.checks.stillAllowed');
    const groups = [...(checks?.querySelectorAll('h4') ?? [])].map((heading) => heading.textContent);
    expect(groups).toEqual(['publish.checks.untitledPage', 'publish.checks.missingAlt']);
    // Both images on one page are one row with both sources.
    const rows = checks?.querySelectorAll('[data-slot="data-list-item"]');
    expect(rows).toHaveLength(2);
    expect(rows?.[1]?.textContent).toContain('/diagram.png');
    expect(rows?.[1]?.textContent).toContain('/screenshot.png');

    const publish = publishButton();
    expect(isUnavailable(publish)).toBe(false);
    await act(async () => publish.click());
    expect(mutate).toHaveBeenCalledOnce();
  });

  it('disables publishing with the reason while a check error remains', async () => {
    preflight.checks = [check({ code: 'broken-internal-link', severity: 'error', detail: '/configuration' }), check({})];
    const beforePublish = vi.fn();
    await act(async () =>
      root.render(<PublishModal beforePublish={beforePublish} onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />),
    );
    const checks = document.querySelector('[data-testid="publish-checks"]');
    expect(checks?.textContent).toContain('publish.checks.errorCount · publish.checks.warningCount · publish.checks.mustFix');
    expect(checks?.textContent).toContain('/configuration');
    const publish = publishButton();
    expect(isUnavailable(publish)).toBe(true);
    const reasonId = publish.getAttribute('aria-describedby')?.split(' ').at(-1);
    expect(reasonId && document.getElementById(reasonId)?.textContent).toBe('publish.checks.blockedReason');
    await act(async () => publish.click());
    expect(beforePublish).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('does not publish when the post-save preflight finds a check error', async () => {
    refreshPreflight.mockResolvedValue({
      data: { redirectIssues: [], checks: [check({ code: 'broken-internal-link', severity: 'error' })], reviewedStateHash: 'reviewed-hash' },
      isError: false,
    });
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    await act(async () => publishButton().click());
    expect(refreshPreflight).toHaveBeenCalledOnce();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('opens the page in the editor from Fix and closes the dialog', async () => {
    preflight.checks = [check({ code: 'broken-internal-link', severity: 'error', detail: '/configuration' })];
    const onOpenChange = vi.fn();
    await act(async () => root.render(<PublishModal onOpenChange={onOpenChange} onPublished={vi.fn()} open project={project} />));
    const fix = [...document.querySelectorAll<HTMLAnchorElement>('[data-testid="publish-checks"] a')].find(
      (link) => link.textContent === 'publish.checks.fix',
    );
    expect(fix?.getAttribute('href')).toBe('/app/projects/project-a/editor?page=page-b');
    expect(fix?.getAttribute('aria-label')).toBe('publish.checks.fixLabel');
    // jsdom cannot follow a link; the router handles it in the app.
    fix?.addEventListener('click', (event) => event.preventDefault());
    await act(async () => fix?.click());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it.each(['admin', 'owner'])('links %s directly to the Redirects subsection', async (role) => {
    preflight.role = role;
    preflight.issues = [{ code: 'cycle', message: 'RAW developer cycle trace', sequence: ['/old', '/new', '/old'], rowIndexes: [0, 1] }];
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    expect(document.body.textContent).toContain('publish.redirectIssue.cycle');
    expect(document.body.textContent).not.toContain('RAW developer');
    const link = document.querySelector<HTMLAnchorElement>('a[href="/app/projects/project-a/settings?section=redirects"]');
    expect(link?.textContent).toBe('publish.editRedirects');
    const publish = publishButton();
    expect(isUnavailable(publish)).toBe(true);
    expect(reasonOf(publish)).toBe('publish.redirectsBlocked');
    expect(mutate).not.toHaveBeenCalled();
  });

  it('asks an Editor to contact a site Admin without linking to restricted settings', async () => {
    preflight.role = 'member';
    preflight.issues = [{ code: 'cycle', message: 'RAW developer cycle trace', sequence: ['/old', '/new'], rowIndexes: [0] }];
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    expect(document.body.textContent).toContain('publish.redirectsAskAdmin');
    expect(document.querySelector('a[href*="section=appearance"]')).toBeNull();
    expect(document.body.textContent).not.toContain('publish.editRedirects');
  });

  it.each(['members', 'session'])('keeps permissions neutral while %s are loading', async (pending) => {
    preflight.membersPending = pending === 'members';
    preflight.sessionPending = pending === 'session';
    preflight.issues = [{ code: 'cycle', message: 'Redirect loop', sequence: ['/old', '/new'], rowIndexes: [0] }];
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    expect(document.body.textContent).toContain('publish.redirectRolePending');
    expect(document.body.textContent).not.toContain('publish.redirectsAskAdmin');
    expect(document.body.textContent).not.toContain('publish.editRedirects');
    expect(document.querySelector('a[href*="section=appearance"]')).toBeNull();
  });

  it('offers Retry when members fail without cached data, without assuming the Editor role', async () => {
    preflight.membersError = true;
    preflight.membersMissing = true;
    preflight.issues = [{ code: 'cycle', message: 'Redirect loop', sequence: ['/old', '/new'], rowIndexes: [0] }];
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    expect(document.body.textContent).toContain('publish.redirectRoleError');
    expect(document.body.textContent).not.toContain('publish.redirectsAskAdmin');
    expect(document.querySelector('a[href*="section=appearance"]')).toBeNull();
    const retry = [...document.querySelectorAll('button')].find((button) => button.textContent === 'common.retry');
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    expect(retryMembers).toHaveBeenCalledOnce();
    preflight.membersFetching = true;
    preflight.membersPending = true;
    preflight.membersError = false;
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    expect(document.body.textContent).toContain('publish.redirectRolePending');
    expect(document.body.textContent).not.toContain('publish.redirectsAskAdmin');
    preflight.membersFetching = false;
    preflight.membersPending = false;
    preflight.membersError = false;
    preflight.membersMissing = false;
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    expect(document.querySelector('a[href*="section=redirects"]')).not.toBeNull();
  });

  it.each(['admin', 'owner', 'member'])('retains the cached %s role after a failed background refetch', async (role) => {
    preflight.role = role;
    preflight.issues = [{ code: 'cycle', message: 'Redirect loop', sequence: ['/old', '/new'], rowIndexes: [0] }];
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    preflight.membersError = true;
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    expect(document.body.textContent).not.toContain('publish.redirectRoleError');
    expect(document.body.textContent).not.toContain('publish.redirectRolePending');
    expect([...document.querySelectorAll('button')].some((button) => button.textContent === 'common.retry')).toBe(false);
    if (role === 'member') {
      expect(document.body.textContent).toContain('publish.redirectsAskAdmin');
    } else {
      expect(document.querySelector('a[href*="section=redirects"]')).not.toBeNull();
      expect(document.body.textContent).not.toContain('publish.redirectsAskAdmin');
    }
  });

  it('keeps publish available for retry without creating a deployment when saving fails', async () => {
    const beforePublish = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    await act(async () =>
      root.render(<PublishModal beforePublish={beforePublish} onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />),
    );
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    if (!publish) throw new Error('Publish action was not rendered');
    await act(async () => publish.click());
    expect(mutate).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith('editor.saveError');
    expect(publish.disabled).toBe(false);
    await act(async () => publish.click());
    expect(mutate).toHaveBeenCalledOnce();
  });

  it('blocks a cached preflight while the latest saved changes are being fetched', async () => {
    preflight.isFetching = true;
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    if (!publish) throw new Error('Publish action was not rendered');
    // Unavailable, and says why (it stays focusable, so it is aria-disabled).
    expect(isUnavailable(publish)).toBe(true);
    expect(reasonOf(publish)).toBe('publish.checking');
    await act(async () => publish.click());
    expect(mutate).not.toHaveBeenCalled();
    preflight.isFetching = false;
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    expect(isUnavailable(publish)).toBe(false);
  });

  it('uses the post-save preflight result before starting a deployment', async () => {
    refreshPreflight.mockResolvedValue({ data: { redirectIssues: [{ message: 'Redirect loop' }] }, isError: false });
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    if (!publish) throw new Error('Publish action was not rendered');
    await act(async () => publish.click());
    expect(refreshPreflight).toHaveBeenCalledOnce();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('silently stops when unsaved configuration blocks publishing and allows a later retry', async () => {
    const beforePublish = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await act(async () =>
      root.render(<PublishModal beforePublish={beforePublish} onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />),
    );
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    if (!publish) throw new Error('Publish action was not rendered');
    await act(async () => publish.click());
    expect(refreshPreflight).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
    expect(publish.disabled).toBe(false);
    await act(async () => publish.click());
    expect(mutate).toHaveBeenCalledOnce();
  });

  it('does not publish after Cancel while the draft save is still pending', async () => {
    let finishSaving!: () => void;
    const beforePublish = () =>
      new Promise<void>((resolve) => {
        finishSaving = resolve;
      });
    const onOpenChange = vi.fn();
    await act(async () =>
      root.render(<PublishModal beforePublish={beforePublish} onOpenChange={onOpenChange} onPublished={vi.fn()} open project={project} />),
    );
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    const cancel = [...document.querySelectorAll('button')].find((button) => button.textContent === 'common.cancel');
    if (!publish || !cancel) throw new Error('Publish actions were not rendered');
    await act(async () => publish.click());
    await act(async () => cancel.click());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await act(async () => finishSaving());
    expect(refreshPreflight).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
  });

  it('does not publish after Cancel while the post-save preflight is still pending', async () => {
    let finishPreflight!: (result: { data: { redirectIssues: [] }; isError: false }) => void;
    refreshPreflight.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPreflight = resolve;
        }),
    );
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    const cancel = [...document.querySelectorAll('button')].find((button) => button.textContent === 'common.cancel');
    if (!publish || !cancel) throw new Error('Publish actions were not rendered');
    await act(async () => publish.click());
    expect(refreshPreflight).toHaveBeenCalledOnce();
    await act(async () => cancel.click());
    await act(async () => finishPreflight({ data: { redirectIssues: [] }, isError: false }));
    expect(mutate).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
  });

  it('invalidates a pending save when the publish UI unmounts', async () => {
    let finishSaving!: () => void;
    const beforePublish = () =>
      new Promise<void>((resolve) => {
        finishSaving = resolve;
      });
    await act(async () =>
      root.render(<PublishModal beforePublish={beforePublish} onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />),
    );
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    if (!publish) throw new Error('Publish action was not rendered');
    await act(async () => publish.click());
    await act(async () => root.unmount());
    await act(async () => finishSaving());
    expect(refreshPreflight).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });

  describe('what there is to publish', () => {
    // The review suite below doesn't reset these; leave the default site behind.
    afterEach(() => {
      preflight.changes = undefined;
      preflight.hasBaseline = true;
      preflight.upToDate = false;
      preflight.isFetching = false;
    });
    /** Mirrors Testing Library's getByRole('button', { name }), which isn't installed here. */
    const buttonNamed = (name: string) => {
      const match = [...document.querySelectorAll<HTMLElement>('button, [role="button"]')].find(
        (element) => getRole(element) === 'button' && !isInaccessible(element) && computeAccessibleName(element) === name,
      );
      if (!match) throw new Error(`No accessible button named ${name}`);
      return match as HTMLButtonElement;
    };
    const renderModal = () => act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    const group = { ...pendingChange, id: 'group-a', kind: 'GROUP', status: 'added', title: 'Guides', path: 'guides' };

    it('says a never-published site with no pages is not published yet, and explains why Publish is unavailable', async () => {
      preflight.hasBaseline = false;
      preflight.changes = [group];
      await renderModal();
      expect(document.body.textContent).toContain('overview.live.unavailable');
      expect(document.body.textContent).toContain('publish.firstPublishHint');
      expect(document.body.textContent).not.toContain('publish.none');
      expect(document.querySelector('[data-testid="publish-empty"]')?.textContent).toBe('publish.addPageFirst');
      const publish = buttonNamed('publish.now');
      expect(isUnavailable(publish)).toBe(true);
      expect(computeAccessibleDescription(publish)).toBe('publish.addPageFirst');
      await act(async () => publish.click());
      expect(mutate).not.toHaveBeenCalled();
    });

    it('offers the first publish once the site has a page', async () => {
      preflight.hasBaseline = false;
      preflight.changes = [group, { ...pendingChange, status: 'added' }];
      await renderModal();
      expect(document.body.textContent).toContain('publish.firstPublish');
      expect(document.body.textContent).not.toContain('publish.none');
      const publish = buttonNamed('publish.now');
      expect(isUnavailable(publish)).toBe(false);
      expect(computeAccessibleDescription(publish)).toBe('');
      await act(async () => publish.click());
      expect(mutate).toHaveBeenCalledOnce();
    });

    it('keeps "no changes" on a published site with nothing to publish and explains the disabled Publish', async () => {
      preflight.changes = [];
      preflight.upToDate = true;
      await renderModal();
      expect(document.querySelector('[data-testid="publish-empty"]')?.textContent).toBe('publish.nonepublish.upToDate');
      expect(document.body.textContent).not.toContain('overview.live.unavailable');
      const publish = buttonNamed('publish.now');
      expect(isUnavailable(publish)).toBe(true);
      expect(computeAccessibleDescription(publish)).toBe('publish.upToDate');
      await act(async () => publish.click());
      expect(mutate).not.toHaveBeenCalled();
    });

    it('still publishes settings-only changes on a published site without claiming nothing changed', async () => {
      preflight.changes = [];
      preflight.upToDate = false;
      await renderModal();
      expect(document.querySelector('[data-testid="publish-empty"]')?.textContent).toBe('publish.noneHint');
      const publish = buttonNamed('publish.now');
      expect(isUnavailable(publish)).toBe(false);
      await act(async () => publish.click());
      expect(mutate).toHaveBeenCalledOnce();
    });

    const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 50)));

    it('opens on the primary action, not the optional note, whose label is in sentence case', async () => {
      await renderModal();
      await settle();
      const publish = buttonNamed('publish.now');
      expect(document.activeElement).toBe(publish);
      const note = document.getElementById('publish-message');
      expect(note && computeAccessibleName(note)).toBe('publish.whatChanged');
      expect(document.activeElement).not.toBe(note);
      const label = document.querySelector('label[for="publish-message"]');
      expect(label?.className).not.toMatch(/uppercase/);
    });

    it('opens on the primary action while the first check runs, explained, never on the note', async () => {
      preflight.isFetching = true;
      await renderModal();
      await settle();
      const publish = buttonNamed('publish.now');
      expect(document.activeElement).toBe(publish);
      expect(publish.getAttribute('aria-disabled')).toBe('true');
      expect(document.activeElement).not.toBe(document.getElementById('publish-message'));
      preflight.isFetching = false;
      await renderModal();
      await settle();
      // The same button, now ready, keeps focus.
      expect(buttonNamed('publish.now')).toBe(publish);
      expect(document.activeElement).toBe(publish);
      expect(publish.getAttribute('aria-disabled')).toBeNull();
    });

    it('opens on the explained, still-focusable action when there is nothing to publish', async () => {
      preflight.changes = [];
      preflight.upToDate = true;
      await renderModal();
      await settle();
      const publish = buttonNamed('publish.now');
      expect(document.activeElement).toBe(publish);
      expect(publish.getAttribute('aria-disabled')).toBe('true');
    });

    it('keeps focus on the same action through a background re-check and back', async () => {
      preflight.changes = [];
      preflight.upToDate = true;
      await renderModal();
      await settle();
      const publish = buttonNamed('publish.now');
      expect(document.activeElement).toBe(publish);
      // A background re-read: the reason goes away while it runs, then comes back.
      preflight.isFetching = true;
      await renderModal();
      await settle();
      expect(buttonNamed('publish.now')).toBe(publish);
      expect(document.activeElement).toBe(publish);
      preflight.isFetching = false;
      await renderModal();
      await settle();
      expect(buttonNamed('publish.now')).toBe(publish);
      expect(document.activeElement).toBe(publish);
      expect(publish.getAttribute('aria-disabled')).toBe('true');
      // And when changes arrive, the same button becomes the ready action.
      preflight.upToDate = false;
      preflight.changes = undefined;
      await renderModal();
      await settle();
      expect(buttonNamed('publish.now')).toBe(publish);
      expect(document.activeElement).toBe(publish);
      expect(publish.getAttribute('aria-disabled')).toBeNull();
    });
  });
});

const line = (type: 'added' | 'removed' | 'unchanged', text: string, oldLine: number | null, newLine: number | null) => ({
  type,
  text,
  oldLine,
  newLine,
});

describe('review changes', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    pendingChange.lines = [];
    pendingChange.truncated = false;
  });

  const openReview = async () => {
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    const review = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('publish.reviewDiff'));
    if (!review) throw new Error('Review action was not rendered');
    await act(async () => review.click());
  };

  it('shows the edited text line by line, each line in its own direction and named for screen readers', async () => {
    pendingChange.lines = [
      line('unchanged', 'Refunds take', 1, 1),
      line('removed', 'Refunds cost $10.', 2, null),
      line('added', 'تكلفة الاسترداد ١٥ دولارًا.', null, 2),
    ];
    await openReview();
    const texts = [...document.querySelectorAll('[dir="auto"]')].map((element) => element.textContent);
    expect(texts).toEqual(expect.arrayContaining(['Refunds cost $10.', 'تكلفة الاسترداد ١٥ دولارًا.']));
    expect(document.body.textContent).toContain('publish.removed');
    expect(document.body.textContent).toContain('publish.added');
    expect(document.body.innerHTML).not.toContain('#0b0b0b');
  });

  it('tells screen-reader users where unchanged lines were skipped', async () => {
    pendingChange.lines = [
      ...Array.from({ length: 10 }, (_, index) => line('unchanged', `line ${index + 1}`, index + 1, index + 1)),
      line('added', 'new line', null, 11),
    ];
    await openReview();
    const skipped = [...document.querySelectorAll('.sr-only')].filter((element) => element.textContent === 'publish.unchangedHidden');
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.closest('[aria-hidden]')).toBeNull();
  });

  it('says when the text did not change and when the list was shortened', async () => {
    pendingChange.lines = [line('unchanged', 'Same text', 1, 1)];
    pendingChange.truncated = true;
    await openReview();
    expect(document.body.textContent).toContain('publish.noLineDiff');
    expect(document.body.textContent).toContain('publish.diffTruncated');
  });
});

describe('reviewRows', () => {
  it('keeps a few lines around each change and collapses long unchanged stretches', () => {
    const lines = Array.from({ length: 20 }, (_, index) => line('unchanged', `line ${index + 1}`, index + 1, index + 1));
    lines[10] = line('added', 'new line', null, 11);
    const rows = reviewRows(lines, 2);
    expect(rows.map((row) => (row.kind === 'gap' ? '⋯' : row.line.text))).toEqual(['⋯', 'line 9', 'line 10', 'new line', 'line 12', 'line 13', '⋯']);
  });

  it('shows everything when the changes are close together', () => {
    const lines = [line('removed', 'a', 1, null), line('unchanged', 'b', 2, 1), line('added', 'c', null, 2)];
    expect(reviewRows(lines, 1).every((row) => row.kind === 'line')).toBe(true);
  });
});
