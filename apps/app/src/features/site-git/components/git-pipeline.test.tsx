// @vitest-environment jsdom
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { translateFn } from '@nibleaf/i18n/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { liveDeploymentsKey } from '@/hooks/api/deployment-cache';
import { queryKeys } from '@/hooks/api/query-keys';
import type { Deployment } from '@/hooks/api/types';
import { localeTag } from '@/lib/format';
import type { PipelineGitMetadata } from '../model/git-pipeline';

// The real deployments queries (keys, request ownership, live selection) over
// the RPC client, answered here per site: `attempts` is the newest-50 list, `live` the READY-only one.
const server = vi.hoisted(() => ({
  sites: {} as Record<string, { attempts: unknown[]; live: unknown[] }>,
  requests: [] as Array<{ projectId: string; query: Record<string, string> }>,
}));
vi.mock('@/services/api', () => ({
  api: {
    app: {
      projects: {
        ':projectId': {
          deployments: {
            $get: async ({ param, query }: { param: { projectId: string }; query: Record<string, string> }) => {
              server.requests.push({ projectId: param.projectId, query });
              const site = server.sites[param.projectId] ?? { attempts: [], live: [] };
              return Response.json({ data: query.status === 'READY' ? site.live : site.attempts });
            },
          },
        },
      },
    },
  },
}));

import { GitPipeline } from './git-pipeline';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const deployment = (version: number, status: Deployment['status'], pagesCount = 4): Deployment => ({
  id: `d${version}`,
  version,
  status,
  pagesCount,
  commitMessage: null,
  error: null,
  createdAt: '2026-11-15T08:00:00.000Z',
  completedAt: status === 'READY' || status === 'FAILED' ? '2026-11-15T08:01:00.000Z' : null,
});
const EARLY = '2026-11-15T09:00:00.000Z';
const LATE = '2026-11-15T10:30:00.000Z';

describe('GitPipeline over the deployments queries', () => {
  let host: HTMLDivElement;
  let root: Root;
  let client: QueryClient;
  const onImport = vi.fn();

  beforeEach(async () => {
    await setLanguage('en');
    server.sites = {};
    server.requests = [];
    onImport.mockReset();
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    client.clear();
    await setLanguage('en');
  });

  /** Lets both queries answer and render. */
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  const render = async ({ projectId = 'site-1', git = {} as PipelineGitMetadata, importing = false } = {}) => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <GitPipeline projectId={projectId} git={git} onImport={onImport} importing={importing} />
        </QueryClientProvider>,
      ),
    );
    await settle();
  };
  /** Each step's label and detail, in order. */
  const steps = () =>
    [...host.querySelectorAll('.relative.flex.gap-3')].map((step) => {
      const [label, detail] = [...step.querySelectorAll('.min-w-0.leading-snug > div')].map((node) => node.textContent);
      return { label, detail };
    });
  const detail = (index: number) => steps()[index]?.detail;
  const t = (key: Parameters<typeof translateFn>[0], vars?: Record<string, string | number>, locale: 'en' | 'ar' = 'en') =>
    translateFn(key, vars, locale);
  const when = (iso: string, locale = 'en') =>
    new Intl.DateTimeFormat(localeTag(locale), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

  it('reads the attempts and the live-only list under their existing keys, one request each, for its own site', async () => {
    server.sites['site-1'] = { attempts: [deployment(2, 'READY')], live: [deployment(2, 'READY')] };
    await render();
    expect(server.requests).toEqual([
      { projectId: 'site-1', query: {} },
      { projectId: 'site-1', query: { status: 'READY' } },
    ]);
    expect(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toEqual([queryKeys.deployments.all('site-1'), liveDeploymentsKey('site-1')]);
  });

  it('shows no attempts as no builds and not live', async () => {
    await render();
    expect(steps()).toEqual([
      { label: t('settings.git.pipeline.import'), detail: t('settings.git.import.never') },
      { label: t('settings.git.pipeline.build'), detail: t('settings.git.pipeline.noBuilds') },
      { label: t('settings.git.pipeline.live'), detail: t('settings.git.pipeline.notLive') },
    ]);
    expect(host.querySelector('a[href="/sites/site-1"]')).toBeNull();
  });

  it('keeps the live version when 50 newer attempts failed and only the live-only list has it', async () => {
    server.sites['site-1'] = {
      attempts: Array.from({ length: 50 }, (_, index) => deployment(60 - index, 'FAILED')),
      live: [deployment(3, 'READY', 9)],
    };
    await render();
    expect(detail(1)).toBe(t('settings.git.pipeline.failed', { version: 60 }));
    expect(detail(2)).toBe(t('settings.git.pipeline.built', { version: 3, pages: 9 }));
    expect(host.querySelector('a[href="/sites/site-1"]')?.getAttribute('target')).toBe('_blank');
  });

  it.each([
    ['a newer failure', 'FAILED' as const, 'settings.git.pipeline.failed' as const],
    ['a build in flight', 'BUILDING' as const, 'settings.git.pipeline.building' as const],
    ['a queued build', 'PENDING' as const, 'settings.git.pipeline.building' as const],
  ])('shows %s on Build and the older live version on Live', async (_name, status, key) => {
    server.sites['site-1'] = { attempts: [deployment(8, status), deployment(7, 'READY', 6)], live: [deployment(7, 'READY', 6)] };
    await render();
    expect(detail(1)).toBe(t(key, { version: 8 }));
    expect(detail(2)).toBe(t('settings.git.pipeline.built', { version: 7, pages: 6 }));
  });

  it('never calls a first build in flight live', async () => {
    server.sites['site-1'] = { attempts: [deployment(1, 'PENDING')], live: [] };
    await render();
    expect(detail(1)).toBe(t('settings.git.pipeline.building', { version: 1 }));
    expect(detail(2)).toBe(t('settings.git.pipeline.notLive'));
    expect(host.querySelector('a')).toBeNull();
  });

  it('gives a push sync tied with the manual import the Import step', async () => {
    await render({ git: { lastImportedAt: EARLY, lastSyncAt: EARLY, lastSyncStatus: 'ok' } });
    expect(detail(0)).toBe(t('settings.git.pipeline.lastSync', { when: when(EARLY) }));
  });

  it('shows a failed sync with its error as plain text, then the later success', async () => {
    const error = '<img src=x onerror=alert(1)> fatal: not found';
    await render({ git: { lastImportedAt: EARLY, lastSyncAt: LATE, lastSyncStatus: 'failed', lastSyncError: error } });
    expect(detail(0)).toBe(`${t('settings.git.pipeline.syncFailed', { when: when(LATE) })} — ${error}`);
    expect(host.querySelector('img')).toBeNull();

    const later = '2026-11-15T11:45:00.000Z';
    await render({ git: { lastImportedAt: EARLY, lastSyncAt: later, lastSyncStatus: 'ok', lastSyncError: error } });
    expect(detail(0)).toBe(t('settings.git.pipeline.lastSync', { when: when(later) }));
  });

  it('follows a same-site refetch: the build that was in flight goes live', async () => {
    server.sites['site-1'] = { attempts: [deployment(5, 'BUILDING'), deployment(4, 'READY')], live: [deployment(4, 'READY')] };
    await render();
    expect(detail(2)).toBe(t('settings.git.pipeline.built', { version: 4, pages: 4 }));
    server.sites['site-1'] = {
      attempts: [deployment(5, 'READY', 11), deployment(4, 'READY')],
      live: [deployment(5, 'READY', 11), deployment(4, 'READY')],
    };
    await act(async () => client.refetchQueries());
    await settle();
    expect(detail(1)).toBe(t('settings.git.pipeline.built', { version: 5, pages: 11 }));
    expect(detail(2)).toBe(t('settings.git.pipeline.built', { version: 5, pages: 11 }));
  });

  it('switches to another site’s deployments and link when the site changes', async () => {
    server.sites['site-1'] = { attempts: [deployment(2, 'READY')], live: [deployment(2, 'READY')] };
    server.sites['site-2'] = { attempts: [deployment(9, 'FAILED')], live: [] };
    await render();
    await render({ projectId: 'site-2' });
    expect(detail(1)).toBe(t('settings.git.pipeline.failed', { version: 9 }));
    expect(detail(2)).toBe(t('settings.git.pipeline.notLive'));
    expect(host.querySelector('a')).toBeNull();
    expect(server.requests.map((request) => request.projectId)).toEqual(['site-1', 'site-1', 'site-2', 'site-2']);
  });

  it('re-renders copy and dates in Arabic when the locale changes', async () => {
    server.sites['site-1'] = { attempts: [deployment(2, 'READY')], live: [deployment(2, 'READY')] };
    await render({ git: { lastImportedAt: LATE } });
    expect(detail(0)).toBe(t('settings.git.import.lastImported', { when: when(LATE) }));
    await act(async () => setLanguage('ar'));
    expect(detail(0)).toBe(t('settings.git.import.lastImported', { when: when(LATE, 'ar') }, 'ar'));
    expect(steps().map((step) => step.label)).toEqual(
      (['settings.git.pipeline.import', 'settings.git.pipeline.build', 'settings.git.pipeline.live'] as const).map((key) => t(key, undefined, 'ar')),
    );
    expect(detail(2)).toBe(t('settings.git.pipeline.built', { version: 2, pages: 4 }, 'ar'));
  });

  it('fires the Import callback once per press, with no navigation or request', async () => {
    await render();
    const requests = server.requests.length;
    const before = window.location.href;
    const button = [...host.querySelectorAll('button')].find((item) => item.textContent?.includes(t('settings.git.import.now')));
    await act(async () => button?.click());
    expect(onImport).toHaveBeenCalledOnce();
    expect(server.requests).toHaveLength(requests);
    expect(window.location.href).toBe(before);
  });

  it('shows the busy Import button with its loading text while importing', async () => {
    await render({ importing: true });
    const button = host.querySelector<HTMLButtonElement>('button[data-slot="button"]');
    expect(button?.getAttribute('aria-busy')).toBe('true');
    expect(button?.disabled).toBe(true);
    expect(button?.textContent).toContain(t('settings.git.import.importing'));
    await act(async () => button?.click());
    expect(onImport).not.toHaveBeenCalled();
  });
});
