// @vitest-environment jsdom
// Real QueryClient and real mutations; only the HTTP calls are replaced, and held until the test answers them.
// Both actions are server-confirmed writes: nothing changes on screen before the server answers.
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  patch: vi.fn(),
  run: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: mocks.success } }));
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
vi.mock('@/services/api', () => ({
  api: { app: { projects: { ':projectId': { exports: { schedules: { ':scheduleId': { $patch: mocks.patch, run: { $post: mocks.run } } } } } } } },
}));

import { queryKeys } from '@/hooks/api/query-keys';
import type { ScheduleRowSource } from '../model/schedule-row';
import { ScheduleRow } from './schedule-row';

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
    answer: async (response: Response) => {
      await act(async () => resolve(response));
      await settle();
    },
  };
}

const schedule = (overrides: Partial<ScheduleRowSource> = {}): ScheduleRowSource => ({
  id: 'schedule-1',
  name: 'Daily backup',
  cadence: 'DAILY',
  timezone: 'UTC',
  hour: 2,
  minute: 0,
  enabled: true,
  nextRunAt: null,
  lastError: null,
  _count: { jobs: 2 },
  ...overrides,
});

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
/** What the schedules list returns per site; read again whenever a site's exports are invalidated. */
let server: Record<string, ScheduleRowSource[]>;
const listReads = vi.fn();

function List({ projectId, canManage = true }: { projectId: string; canManage?: boolean }) {
  const { data } = useQuery({
    queryKey: queryKeys.exports.schedules(projectId),
    queryFn: async () => {
      listReads(projectId);
      return structuredClone(server[projectId] ?? []);
    },
  });
  return (
    <>
      {data?.map((item) => (
        <ScheduleRow canManage={canManage} hasLiveVersion key={item.id} projectId={projectId} schedule={item} />
      ))}
    </>
  );
}
const render = async (node: React.ReactNode) => {
  await act(async () => root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
  await settle();
};
/** One row whose site changes in place: the same component instance, as a pending request sees it. */
const renderRow = (projectId: string, item = schedule()) => render(<ScheduleRow canManage hasLiveVersion projectId={projectId} schedule={item} />);

const buttons = () => [...container.querySelectorAll('button')];
/** A button by its accessible name (its text, including the visually hidden schedule name). */
const button = (name: string) => buttons().find((item) => item.textContent?.replace(/\s+/g, ' ').trim() === name);
const press = async (element: HTMLElement | undefined) => {
  await act(async () => element?.click());
  await settle();
};
const invalidated = (projectId: string) => client.getQueryState(queryKeys.exports.schedules(projectId))?.isInvalidated ?? false;
const seed = (...projectIds: string[]) => {
  for (const projectId of projectIds) client.setQueryData(queryKeys.exports.schedules(projectId), server[projectId] ?? []);
};

beforeEach(() => {
  mocks.locale = 'en';
  server = { 'site-a': [schedule()], 'site-b': [schedule()] };
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  client.clear();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('request ownership (A → B → A in one row)', () => {
  it.each([
    ['Disable Daily backup', 'success'],
    ['Disable Daily backup', 'failure'],
    ['Run now Daily backup', 'success'],
    ['Run now Daily backup', 'failure'],
  ] as const)('%s: a late %s refreshes only the site it was sent for', async (action, outcome) => {
    const request = held();
    (action.startsWith('Run') ? mocks.run : mocks.patch).mockReturnValueOnce(request.promise);
    seed('site-a', 'site-b');
    await renderRow('site-a');
    await press(button(action));
    await renderRow('site-b');
    await request.answer(outcome === 'success' ? ok() : refused(500));
    await renderRow('site-a');

    // A failed run created nothing, so nothing is read again; a failed Enable/Disable reads its own site back.
    expect(invalidated('site-a')).toBe(outcome === 'success' || action.startsWith('Disable'));
    expect(invalidated('site-b')).toBe(false);
    // The failure belongs to a view that is gone, even though the row shows site A again.
    expect(mocks.error).not.toHaveBeenCalled();
    // A queued run really happened, so it is reported wherever the person is now.
    expect(mocks.success).toHaveBeenCalledTimes(outcome === 'success' && action.startsWith('Run') ? 1 : 0);
  });

  it('lets the row act for its new site while the old site’s request is still pending', async () => {
    const first = held();
    mocks.run.mockReturnValueOnce(first.promise).mockResolvedValueOnce(ok());
    await renderRow('site-a');
    await press(button('Run now Daily backup'));
    await renderRow('site-b');
    expect(button('Run now Daily backup')?.getAttribute('aria-busy')).toBeNull();
    await press(button('Run now Daily backup'));
    expect(mocks.run.mock.calls.map(([request]) => request.param.projectId)).toEqual(['site-a', 'site-b']);
    await first.answer(ok());
  });
});

describe('Run now', () => {
  it('sends one request per activation while it is pending, to the unchanged endpoint with no body', async () => {
    const request = held();
    mocks.run.mockReturnValueOnce(request.promise);
    await render(<List projectId="site-a" />);
    const run = button('Run now Daily backup');
    // Two presses in the same tick, before React shows the pending state, then one more while it shows.
    await act(async () => {
      run?.click();
      run?.click();
    });
    await settle();
    await press(run);
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith({ param: { projectId: 'site-a', scheduleId: 'schedule-1' } });
    expect(run?.getAttribute('aria-busy')).toBe('true');
    await request.answer(ok({ id: 'run-1' }));
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith('Archive run queued.');
    expect(run?.getAttribute('aria-busy')).toBeNull();
  });

  it.each([
    [409, 'Too many exports right now. Wait for the running ones to finish, or try again tomorrow.'],
    [400, 'This site is too large to export. Ask whoever runs Nibleaf for you (your IT team or Nibleaf support) to raise the limit.'],
  ])('words a refused run (%i) as before and refreshes nothing', async (status, message) => {
    mocks.run.mockResolvedValueOnce(refused(status));
    await render(<List projectId="site-a" />);
    listReads.mockClear();
    await press(button('Run now Daily backup'));
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith(message);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(listReads).not.toHaveBeenCalled();
  });

  it('reports a run queued after the row was closed, but not a failure', async () => {
    const queued = held();
    const failed = held();
    mocks.run.mockReturnValueOnce(queued.promise);
    await render(<List projectId="site-a" />);
    await press(button('Run now Daily backup'));
    await render(null);
    await queued.answer(ok());
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith('Archive run queued.');

    mocks.run.mockReturnValueOnce(failed.promise);
    await render(<List projectId="site-a" />);
    await press(button('Run now Daily backup'));
    await render(null);
    await failed.answer(refused(500));
    expect(mocks.error).not.toHaveBeenCalled();
  });
});

describe('Enable/Disable', () => {
  it('sends only the value asked for, stays the server’s value while pending and shows the answer', async () => {
    const request = held();
    mocks.patch.mockReturnValueOnce(request.promise);
    await render(<List projectId="site-a" />);
    const toggle = button('Disable Daily backup');
    await act(async () => {
      toggle?.click();
      toggle?.click();
    });
    await settle();
    expect(mocks.patch).toHaveBeenCalledExactlyOnceWith({ param: { projectId: 'site-a', scheduleId: 'schedule-1' }, json: { enabled: false } });
    expect(toggle?.getAttribute('aria-busy')).toBe('true');
    expect(container.textContent).toContain('enabled');

    server['site-a'] = [schedule({ enabled: false })];
    await request.answer(ok(schedule({ enabled: false })));
    expect(button('Enable Daily backup')).toBeDefined();
    expect(container.querySelector('[data-slot="badge"]')?.textContent).toBe('disabled');

    mocks.patch.mockResolvedValueOnce(ok());
    await press(button('Enable Daily backup'));
    expect(mocks.patch).toHaveBeenLastCalledWith({ param: { projectId: 'site-a', scheduleId: 'schedule-1' }, json: { enabled: true } });
  });

  it('keeps the server’s value after a refused change, reads it back, and lets the person retry', async () => {
    mocks.patch.mockResolvedValueOnce(refused(500)).mockResolvedValueOnce(ok());
    await render(<List projectId="site-a" />);
    listReads.mockClear();
    await press(button('Disable Daily backup'));
    expect(mocks.error).toHaveBeenCalledExactlyOnceWith('Could not save');
    expect(listReads).toHaveBeenCalledExactlyOnceWith('site-a');
    expect(button('Disable Daily backup')?.getAttribute('aria-busy')).toBeNull();
    expect(container.querySelector('[data-slot="badge"]')?.textContent).toBe('enabled');

    server['site-a'] = [schedule({ enabled: false })];
    await press(button('Disable Daily backup'));
    expect(mocks.patch).toHaveBeenCalledTimes(2);
    expect(button('Enable Daily backup')).toBeDefined();
  });

  it('shows what the server reads back after a refusal, not the value from before it', async () => {
    mocks.patch.mockResolvedValueOnce(refused(409));
    await render(<List projectId="site-a" />);
    // Someone else disabled it meanwhile.
    server['site-a'] = [schedule({ enabled: false })];
    await press(button('Disable Daily backup'));
    expect(button('Enable Daily backup')).toBeDefined();
    expect(container.querySelector('[data-slot="badge"]')?.textContent).toBe('disabled');
  });

  it('keeps focus on the button while busy, and moves no focus when an old failure arrives', async () => {
    const request = held();
    mocks.patch.mockReturnValueOnce(request.promise);
    await render(<List projectId="site-a" />);
    const toggle = button('Disable Daily backup');
    toggle?.focus();
    await press(toggle);
    expect(toggle?.hasAttribute('disabled')).toBe(false);
    expect(toggle?.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(toggle);

    // The row is replaced by a fresh one for the same schedule (the list was left and opened again).
    await render(null);
    await render(<List projectId="site-a" />);
    const replacement = button('Disable Daily backup');
    replacement?.focus();
    await request.answer(refused(500));
    expect(mocks.error).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(replacement);
  });
});

describe('rows', () => {
  it('keeps each row’s pending state to itself', async () => {
    server['site-a'] = [schedule(), schedule({ id: 'schedule-2', name: 'Weekly archive', cadence: 'WEEKLY' })];
    const request = held();
    mocks.run.mockReturnValueOnce(request.promise).mockResolvedValueOnce(ok());
    mocks.patch.mockResolvedValueOnce(ok());
    await render(<List projectId="site-a" />);
    await press(button('Run now Daily backup'));
    expect(button('Run now Daily backup')?.getAttribute('aria-busy')).toBe('true');
    expect(button('Disable Daily backup')?.getAttribute('aria-busy')).toBeNull();
    expect(button('Run now Weekly archive')?.getAttribute('aria-busy')).toBeNull();

    await press(button('Run now Weekly archive'));
    await press(button('Disable Weekly archive'));
    expect(mocks.run.mock.calls.map(([call]) => call.param.scheduleId)).toEqual(['schedule-1', 'schedule-2']);
    expect(mocks.patch).toHaveBeenCalledExactlyOnceWith({ param: { projectId: 'site-a', scheduleId: 'schedule-2' }, json: { enabled: false } });
    await request.answer(ok());
  });

  it('shows the schedule but no management control to people who cannot manage schedules', async () => {
    server['site-a'] = [schedule({ lastError: 'No published revision is available.' })];
    await render(<List canManage={false} projectId="site-a" />);
    expect(container.textContent).toContain('Daily backup');
    expect(container.textContent).toContain('Daily at 02:00 UTC');
    expect(container.textContent).toContain('2 runs');
    expect(container.textContent).toContain('There is no published version to export. Publish your site, then try again.');
    expect(buttons().filter((item) => !item.closest('details'))).toEqual([]);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.patch).not.toHaveBeenCalled();
  });

  it.each([
    ['en', ['Run now نسخ يومي', 'Disable نسخ يومي'], 'enabled'],
    ['ar', ['تشغيل الآن نسخ يومي', 'تعطيل نسخ يومي'], 'مفعّل'],
  ] as const)('names each action after its schedule, and says its status, in %s', async (locale, names, status) => {
    mocks.locale = locale;
    server['site-a'] = [schedule({ name: 'نسخ يومي' })];
    await render(<List projectId="site-a" />);
    expect(buttons().map((item) => item.textContent?.replace(/\s+/g, ' ').trim())).toEqual(names);
    expect(container.querySelector('[data-slot="badge"]')?.textContent).toBe(status);
  });
});
