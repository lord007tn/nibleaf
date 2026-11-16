// @vitest-environment jsdom
// Real QueryClient (the app's own, with its global mutation error toast) and real mutations and queries; only the
// HTTP calls are replaced, and held until the test answers them. Covers the one-time export in ExportsSection and
// Cancel / download in ExportRunRow.
import { QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  create: vi.fn(),
  cancel: vi.fn(),
  download: vi.fn(),
  list: vi.fn(),
  schedules: vi.fn(),
  runSchedule: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: mocks.success } }));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@nibleaf/i18n/react', async () => {
  const { translateFn } = await vi.importActual<typeof import('@nibleaf/i18n')>('@nibleaf/i18n');
  return {
    useT: () => (key: Parameters<typeof translateFn>[0]) => translateFn(key, undefined, mocks.locale),
    useLocale: () => ({
      locale: mocks.locale,
      t: (key: Parameters<typeof translateFn>[0], variables?: Parameters<typeof translateFn>[1]) => translateFn(key, variables, mocks.locale),
    }),
  };
});
// The site is published; its own queries are not under test.
vi.mock('@/hooks/api', () => ({
  useDeployments: () => ({ data: [{ status: 'READY' }] }),
  useProject: () => ({ data: { hasPublishedVersion: true } }),
}));
vi.mock('@/services/api', () => ({
  api: {
    app: {
      projects: {
        ':projectId': {
          exports: {
            $get: mocks.list,
            $post: mocks.create,
            schedules: { $get: mocks.schedules, ':scheduleId': { run: { $post: mocks.runSchedule } } },
            ':id': { cancel: { $post: mocks.cancel }, artifacts: { ':artifactId': { download: { $get: mocks.download } } } },
          },
        },
      },
    },
  },
}));

import { ExportsSection } from '@/components/project-settings/exports-section';
import type { ExportRun } from '@/hooks/api/exports';
import { queryKeys } from '@/hooks/api/query-keys';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { ExportRunRow } from '../components/export-run-row';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const ok = (data: unknown = {}) => json(200, { data });
const refused = (status: number, message = 'Refused') => json(status, { error: { message } });
/** Lets queries and mutations settle: TanStack tells React on a timer, so each tick gets its own act. */
const settle = async () => {
  for (let tick = 0; tick < 4; tick += 1) await act(async () => new Promise((done) => setTimeout(done, 0)));
};
function held() {
  let resolve: (value: Response) => void = () => undefined;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return {
    promise,
    resolve: (response: Response) => resolve(response),
    answer: async (response: Response) => {
      await act(async () => resolve(response));
      await settle();
    },
  };
}

const run = (overrides: Partial<ExportRun> = {}): ExportRun => ({
  id: 'run-1',
  formats: ['PDF'],
  status: 'SUCCEEDED',
  trigger: 'MANUAL',
  attempts: 1,
  error: null,
  createdAt: '2026-10-16T09:30:00Z',
  snapshot: { deploymentVersion: 4, pagesCount: 3, createdAt: '2026-10-16T09:00:00Z' },
  artifacts: [{ id: 'pdf', format: 'PDF', fileName: 'handbook-v4.pdf', size: 2048 }],
  schedule: null,
  ...overrides,
});
const running = (id: string, createdAt = '2026-10-16T09:30:00Z') => run({ id, status: 'RUNNING', artifacts: [], createdAt });

let container: HTMLDivElement;
let root: Root;
let client: ReturnType<typeof createQueryClient>;
/** What the runs list returns per site, read whenever a site's exports are fetched. */
let server: Record<string, ExportRun[]>;
let clicks: { href: string; download: string; connected: boolean }[];

const render = async (node: React.ReactNode) => {
  await act(async () => root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
  await settle();
};
const section = (projectId: string, options: { key?: string; canManageSchedules?: boolean } = {}) =>
  render(<ExportsSection canManageSchedules={options.canManageSchedules ?? false} key={options.key} projectId={projectId} />);
/** One row whose site changes in place: the same component instance, as a pending request sees it. */
const row = (projectId: string, item: ExportRun = run()) => render(<ExportRunRow canCreate projectId={projectId} run={item} />);

const buttons = () => [...container.querySelectorAll('button')];
/** A button by its accessible name (its text, including the visually hidden run details). */
const name = (button: HTMLButtonElement) => button.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const button = (prefix: string) => buttons().find((item) => name(item).startsWith(prefix));
const press = async (element: HTMLElement | undefined) => {
  await act(async () => element?.click());
  await settle();
};
const surface = (title: string) => press(buttons().find((item) => item.closest('nav') && item.textContent?.startsWith(title)));
/** Each export prefix a write asked to read again, in order. */
let refreshed: () => unknown[];
const seed = (...projectIds: string[]) => {
  for (const projectId of projectIds) client.setQueryData(queryKeys.exports.runs(projectId), server[projectId] ?? []);
};
const listReads = () => mocks.list.mock.calls.map(([request]) => request.param.projectId);

beforeEach(() => {
  mocks.locale = 'en';
  server = { 'site-a': [run()], 'site-b': [run()] };
  client = createQueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  refreshed = () => invalidate.mock.calls.map(([filters]) => filters?.queryKey);
  mocks.list.mockImplementation(async ({ param }: { param: { projectId: string } }) => ok(structuredClone(server[param.projectId] ?? [])));
  mocks.schedules.mockImplementation(async () => ok([]));
  clicks = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push({ href: this.getAttribute('href') ?? '', download: this.download, connected: this.isConnected });
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  client.clear();
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('one-time export', () => {
  it('sends { formats } in the order they were turned on, once for a same-tick double press, and reports it queued', async () => {
    const request = held();
    mocks.create.mockReturnValueOnce(request.promise);
    await section('site-a');
    await press(container.querySelector<HTMLElement>('#export-format-STATIC_HTML') ?? undefined);
    await press(container.querySelector<HTMLElement>('#export-format-PDF') ?? undefined);
    const create = button('Create export');
    // Two presses in the same tick, before React shows the pending state, then one more while it shows.
    await act(async () => {
      create?.click();
      create?.click();
    });
    await settle();
    await press(create);
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({ param: { projectId: 'site-a' }, json: { formats: ['MARKDOWN', 'STATIC_HTML', 'PDF'] } });
    expect(create?.getAttribute('aria-busy')).toBe('true');
    // The formats stay as chosen while the list is read again.
    await request.answer(json(201, { data: running('run-2') }));
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith('Export queued from the latest published revision.');
    expect(create?.getAttribute('aria-busy')).toBeNull();
    expect(refreshed()).toEqual([queryKeys.exports.all('site-a')]);
    expect(
      [...container.querySelectorAll('[role="switch"]')].map((item) => item.getAttribute('aria-checked') ?? item.getAttribute('data-checked')),
    ).toEqual(['true', 'true', 'true']);
  });

  it.each([
    [409, 'Too many exports right now. Wait for the running ones to finish, or try again tomorrow.'],
    [400, 'This site is too large to export. Ask whoever runs Nibleaf for you (your IT team or Nibleaf support) to raise the limit.'],
    [503, "Couldn't start the export. Try again."],
  ])('words a refusal (%i) once, with no second global error, refreshes nothing, and lets the person retry', async (status, message) => {
    seed('site-a');
    mocks.create.mockResolvedValueOnce(refused(status)).mockResolvedValueOnce(json(201, { data: running('run-2') }));
    await section('site-a');
    await press(button('Create export'));
    await settle();
    expect(mocks.error.mock.calls.map(([text]) => text).filter((text) => text !== message)).toEqual([]);
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(refreshed()).toEqual([]);
    await press(button('Create export'));
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.success).toHaveBeenCalledTimes(1);
  });

  it('reports an export queued after the section was left, but not a refusal', async () => {
    const queued = held();
    const failed = held();
    mocks.create.mockReturnValueOnce(queued.promise).mockReturnValueOnce(failed.promise);
    await section('site-a');
    await press(button('Create export'));
    await render(null);
    await queued.answer(json(201, { data: running('run-2') }));
    expect(mocks.success).toHaveBeenCalledTimes(1);

    await section('site-a');
    await press(button('Create export'));
    await surface('Run history');
    await failed.answer(refused(500));
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each(['same instance', 'keyed, as on the settings page'] as const)(
    'A → B (%s): a late answer refreshes only site A, and a refusal is not shown on B',
    async (mount) => {
      seed('site-a', 'site-b');
      const success = held();
      const failure = held();
      mocks.create
        .mockReturnValueOnce(success.promise)
        .mockReturnValueOnce(failure.promise)
        .mockResolvedValueOnce(json(201, { data: running('run-3') }));
      const at = (projectId: string) => section(projectId, { key: mount === 'same instance' ? undefined : projectId });
      await at('site-a');
      await press(button('Create export'));
      await at('site-b');
      // Site B's export is not held up by site A's.
      expect(button('Create export')?.getAttribute('aria-busy')).toBeNull();
      await success.answer(json(201, { data: running('run-2') }));
      expect(refreshed()).toEqual([queryKeys.exports.all('site-a')]);
      expect(mocks.success).toHaveBeenCalledTimes(1);

      await at('site-a');
      await press(button('Create export'));
      await at('site-b');
      await failure.answer(refused(500));
      await at('site-a');
      expect(mocks.error).not.toHaveBeenCalled();
      await press(button('Create export'));
      expect(mocks.create.mock.calls.map(([request]) => request.param.projectId)).toEqual(['site-a', 'site-a', 'site-a']);
    },
  );
});

describe('Cancel', () => {
  it('is server-confirmed: the status stays until the server answers, then reads back, and polling stops', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const tick = async (ms: number) => {
      await act(async () => vi.advanceTimersByTimeAsync(ms));
    };
    server['site-a'] = [running('run-1')];
    const request = held();
    mocks.cancel.mockReturnValueOnce(request.promise);
    await act(async () =>
      root.render(<QueryClientProvider client={client}>{<ExportsSection canManageSchedules={false} projectId="site-a" />}</QueryClientProvider>),
    );
    await tick(0);
    await act(async () =>
      buttons()
        .find((item) => item.textContent?.startsWith('Run history'))
        ?.click(),
    );
    await tick(0);
    expect(listReads()).toEqual(['site-a']);
    // Polls every 2.5 s while a run is queued or running.
    await tick(2500);
    expect(listReads()).toEqual(['site-a', 'site-a']);

    const cancel = button('Cancel');
    cancel?.focus();
    await act(async () => {
      cancel?.click();
      cancel?.click();
    });
    await tick(0);
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith({ param: { projectId: 'site-a', id: 'run-1' } });
    expect(cancel?.getAttribute('aria-busy')).toBe('true');
    expect(cancel?.hasAttribute('disabled')).toBe(false);
    expect(document.activeElement).toBe(cancel);
    expect(container.querySelector('[data-slot="badge"]')?.textContent).toBe('running');

    const cancelled = run({ id: 'run-1', status: 'CANCELLED', artifacts: [] });
    server['site-a'] = [cancelled];
    await act(async () => request.resolve(ok(cancelled)));
    await tick(0);
    expect(container.querySelector('[data-slot="badge"]')?.textContent).toBe('cancelled');
    expect(button('Cancel')).toBeUndefined();
    const reads = listReads().length;
    await tick(10_000);
    expect(listReads()).toHaveLength(reads);
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('stops polling when the history is left', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    server['site-a'] = [running('run-1')];
    await act(async () =>
      root.render(<QueryClientProvider client={client}>{<ExportsSection canManageSchedules={false} projectId="site-a" />}</QueryClientProvider>),
    );
    await act(async () => vi.advanceTimersByTimeAsync(2500));
    const reads = listReads().length;
    expect(reads).toBe(2);
    await act(async () => root.render(null));
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(listReads()).toHaveLength(reads);
  });

  it('after a refusal keeps no guessed status, reads the run back, and a stale poll cannot overwrite the newer answer', async () => {
    server['site-a'] = [running('run-1')];
    await section('site-a');
    await surface('Run history');
    // A poll is in flight with the old status when the refusal arrives; the server has since finished the run.
    const stalePoll = held();
    mocks.list.mockReturnValueOnce(stalePoll.promise);
    void client.refetchQueries({ queryKey: queryKeys.exports.runs('site-a') });
    server['site-a'] = [run({ id: 'run-1', status: 'SUCCEEDED' })];
    mocks.cancel.mockResolvedValueOnce(refused(409, 'Only queued or running exports can be cancelled.'));
    await press(button('Cancel'));
    await stalePoll.answer(ok([running('run-1')]));
    // A 409 says the run had already ended; the row shows what it ended as.
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith('Could not cancel the export.');
    expect(container.querySelector('[data-slot="badge"]')?.textContent).toBe('succeeded');
    expect(button('Cancel')).toBeUndefined();
  });

  it('keeps each run’s pending state to itself, and leaves downloads and schedules free', async () => {
    server['site-a'] = [running('run-1', '2026-10-16T09:30:00Z'), running('run-2', '2026-10-15T09:30:00Z'), run({ id: 'run-3' })];
    mocks.schedules.mockImplementation(async () =>
      ok([
        {
          id: 'schedule-1',
          name: 'Nightly',
          cadence: 'DAILY',
          timezone: 'UTC',
          hour: 2,
          minute: 0,
          enabled: true,
          nextRunAt: null,
          lastError: null,
          _count: { jobs: 1 },
        },
      ]),
    );
    const first = held();
    mocks.cancel.mockReturnValueOnce(first.promise).mockResolvedValueOnce(ok());
    mocks.download.mockResolvedValueOnce(ok({ fileUrl: '/files/run-3.pdf', fileName: 'run-3.pdf' }));
    mocks.runSchedule.mockResolvedValueOnce(json(201, { data: { id: 'run-4' } }));
    await section('site-a', { canManageSchedules: true });
    await surface('Run history');
    const [cancelFirst, cancelSecond] = buttons().filter((item) => name(item).startsWith('Cancel'));
    await press(cancelFirst);
    expect(cancelFirst?.getAttribute('aria-busy')).toBe('true');
    expect(cancelSecond?.getAttribute('aria-busy')).toBeNull();
    expect(button('PDF')?.getAttribute('aria-busy')).toBeNull();
    await press(cancelSecond);
    await press(button('PDF'));
    expect(mocks.cancel.mock.calls.map(([request]) => request.param.id)).toEqual(['run-1', 'run-2']);
    expect(clicks.map(({ href }) => href)).toEqual(['/files/run-3.pdf']);
    await surface('Schedules');
    await press(button('Run now'));
    expect(mocks.runSchedule).toHaveBeenCalledTimes(1);
    await first.answer(ok());
  });

  it.each(['success', 'failure'] as const)('A → B → A in one row: a late %s reads back only site A and is not reported', async (outcome) => {
    seed('site-a', 'site-b');
    const request = held();
    mocks.cancel.mockReturnValueOnce(request.promise);
    await row('site-a', running('run-1'));
    await press(button('Cancel'));
    await row('site-b', running('run-1'));
    expect(button('Cancel')?.getAttribute('aria-busy')).toBeNull();
    await request.answer(outcome === 'success' ? ok() : refused(500));
    await row('site-a', running('run-1'));
    // Success or failure, the run is read back from the server, for site A only.
    expect(refreshed()).toEqual([queryKeys.exports.all('site-a')]);
    expect(mocks.error).not.toHaveBeenCalled();
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith({ param: { projectId: 'site-a', id: 'run-1' } });
  });
});

describe('download', () => {
  it('asks once for a same-tick double press and clicks one native link that is removed again', async () => {
    const request = held();
    mocks.download.mockReturnValueOnce(request.promise);
    await row('site-a');
    const pdf = button('PDF');
    await act(async () => {
      pdf?.click();
      pdf?.click();
    });
    await settle();
    expect(mocks.download).toHaveBeenCalledExactlyOnceWith({ param: { projectId: 'site-a', id: 'run-1', artifactId: 'pdf' } });
    expect(pdf?.getAttribute('aria-busy')).toBe('true');
    await request.answer(ok({ url: 'https://storage.example.test/signed?token=secret', fileUrl: '/files/handbook-v4.pdf', fileName: 'دليل-v4.pdf' }));
    expect(clicks).toEqual([{ href: '/files/handbook-v4.pdf', download: 'دليل-v4.pdf', connected: true }]);
    expect(document.querySelector('a')).toBeNull();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(pdf?.getAttribute('aria-busy')).toBeNull();
  });

  it('removes the link even when the browser refuses the click, and says the download failed', async () => {
    vi.mocked(HTMLAnchorElement.prototype.click).mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    mocks.download.mockResolvedValueOnce(ok({ fileUrl: '/files/handbook-v4.pdf', fileName: 'handbook-v4.pdf' }));
    await row('site-a');
    await press(button('PDF'));
    expect(document.querySelector('a')).toBeNull();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith('Could not download the export.');
  });

  it('still downloads the file asked for after the row moves to another site, and never site B’s', async () => {
    const request = held();
    mocks.download.mockReturnValueOnce(request.promise);
    await row('site-a');
    await press(button('PDF'));
    await row('site-b');
    expect(button('PDF')?.getAttribute('aria-busy')).toBeNull();
    await request.answer(ok({ fileUrl: '/api/app/projects/site-a/exports/run-1/artifacts/pdf/file', fileName: 'a.pdf' }));
    expect(mocks.download).toHaveBeenCalledExactlyOnceWith({ param: { projectId: 'site-a', id: 'run-1', artifactId: 'pdf' } });
    expect(clicks).toEqual([{ href: '/api/app/projects/site-a/exports/run-1/artifacts/pdf/file', download: 'a.pdf', connected: true }]);
  });

  it.each(['A → B', 'A → B → A', 'closed'] as const)('does not report a failure that arrives after %s', async (path) => {
    const request = held();
    mocks.download.mockReturnValueOnce(request.promise);
    await row('site-a');
    const pdf = button('PDF');
    pdf?.focus();
    await press(pdf);
    expect(document.activeElement).toBe(pdf);
    if (path === 'closed') await render(null);
    else await row('site-b');
    if (path === 'A → B → A') await row('site-a');
    await request.answer(refused(410, 'This export has expired.'));
    expect(mocks.error).not.toHaveBeenCalled();
    expect(clicks).toEqual([]);
    expect(document.activeElement).toBe(path === 'closed' ? document.body : pdf);
  });

  it('reports a failure in the view it was asked from, once', async () => {
    mocks.download.mockResolvedValueOnce(refused(410, 'This export has expired.'));
    await row('site-a');
    await press(button('PDF'));
    await settle();
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith('Could not download the export.');
    expect(clicks).toEqual([]);
  });
});

describe('accessible names', () => {
  it.each([
    ['en', ['Cancel PDF', 'PDF · 2 KiB']],
    ['ar', ['إلغاء PDF', 'PDF · 2 كيبيبايت']],
  ] as const)('names each action after its run in %s', async (locale, [cancel, download]) => {
    mocks.locale = locale;
    await row('site-a', run({ status: 'RUNNING' }));
    const names = buttons().map(name);
    expect(names).toHaveLength(2);
    expect(names[0]?.startsWith(cancel)).toBe(true);
    expect(names[1]?.startsWith(download)).toBe(true);
    // Both end with the run's time, so the same format of two runs can be told apart.
    expect(names.every((item) => item.endsWith(new Date('2026-10-16T09:30:00Z').toLocaleString(locale === 'ar' ? 'ar-u-nu-latn' : 'en')))).toBe(true);
  });
});
