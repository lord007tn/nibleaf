// @vitest-environment jsdom
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  post: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  confirm: vi.fn(),
  report: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: mocks.error, success: mocks.success } }));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));
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
vi.mock('@/services/api', () => ({ api: { app: { projects: { ':projectId': { exports: { schedules: { $post: mocks.post } } } } } } }));
// The parent's other workflows are not under test here.
vi.mock('@/hooks/api', () => ({
  useDeployments: () => ({ data: [{ status: 'READY' }] }),
  useProject: () => ({ data: { hasPublishedVersion: true } }),
}));
vi.mock('@/hooks/api/exports', () => ({
  useListExportRuns: () => ({ data: [] }),
  useListExportSchedules: () => ({ data: [] }),
  useCreateExport: () => ({ mutate: vi.fn() }),
  useCancelExport: () => ({ mutate: vi.fn() }),
  useGetExportDownload: () => ({ mutateAsync: vi.fn() }),
  useUpdateExportSchedule: () => ({ mutate: vi.fn() }),
  useRunExportSchedule: () => ({ mutate: vi.fn() }),
}));

import { ExportsSection } from '@/components/project-settings/exports-section';
import { ConfigDirtyProvider } from '@/components/project-settings/shared';
import { ScheduleCreateForm } from './schedule-create-form';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const created = (projectId = 'site-a') => json(201, { data: { id: 'schedule-new', projectId } });
function deferred() {
  let resolve: (value: Response) => void = () => undefined;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
const onCreated = vi.fn();
const onUnsettled = vi.fn();

const wrap = (node: ReactNode) => (
  <QueryClientProvider client={client}>
    <ConfigDirtyProvider report={mocks.report}>{node}</ConfigDirtyProvider>
  </QueryClientProvider>
);
const renderForm = (projectId = 'site-a', options: { key?: string } = {}) =>
  act(async () =>
    root.render(wrap(<ScheduleCreateForm key={options.key} onCreated={onCreated} onUnsettledChange={onUnsettled} projectId={projectId} />)),
  );
const renderSection = () => act(async () => root.render(wrap(<ExportsSection canManageSchedules projectId="site-a" />)));

const button = (text: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.includes(text));
const field = <T extends HTMLElement = HTMLInputElement>(label: string) => {
  const match = [...container.querySelectorAll('label')].find((item) => item.textContent === label);
  return document.getElementById(match?.htmlFor ?? '') as T;
};
const errorOf = (control: HTMLElement) =>
  (control.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id))
    .find((node) => node?.dataset.slot === 'settings-row-error')?.textContent;
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function leave(input: HTMLElement) {
  await act(async () => {
    input.focus();
    input.blur();
  });
}
async function click(element: HTMLElement | undefined) {
  await act(async () => element?.click());
}
async function choose(trigger: HTMLElement, option: string) {
  await click(trigger);
  await click([...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent === option));
}
const submitNatively = () => act(async () => container.querySelector('form')?.requestSubmit());
const dirtyNow = () => mocks.report.mock.calls.at(-1)?.[1];
const sentBodies = () => mocks.post.mock.calls.map(([request]) => request.json);

beforeEach(() => {
  mocks.locale = 'en';
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Number.POSITIVE_INFINITY } } });
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

describe('creating a schedule', () => {
  it('sends the complete default schedule once, from a native submit, and closes after the server confirms', async () => {
    const response = deferred();
    mocks.post.mockReturnValue(response.promise);
    await renderForm();
    const create = button('Create schedule');
    expect(create?.getAttribute('type')).toBe('submit');

    await click(create);
    await submitNatively();
    await click(button('Creating schedule…'));

    expect(mocks.post).toHaveBeenCalledOnce();
    expect(mocks.post).toHaveBeenCalledWith({
      param: { projectId: 'site-a' },
      json: {
        name: 'Nightly archive',
        formats: ['MARKDOWN', 'PDF', 'STATIC_HTML'],
        cadence: 'DAILY',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        hour: 2,
        minute: 0,
        retentionCount: 12,
        retentionDays: 90,
      },
    });
    // Busy: the button says so, and this form's fields are frozen so nothing typed now can be lost.
    expect(button('Creating schedule…')?.hasAttribute('data-loading')).toBe(true);
    expect(field('Schedule name').disabled).toBe(true);
    expect(field('Runs to retain').disabled).toBe(true);
    expect(container.querySelector('form')?.getAttribute('aria-busy')).toBe('true');
    expect(mocks.success).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();

    await act(async () => response.resolve(created()));

    expect(mocks.success).toHaveBeenCalledExactlyOnceWith('Archive schedule created.');
    expect(onCreated).toHaveBeenCalledOnce();
    expect(mocks.post).toHaveBeenCalledOnce();
  });

  it('shows nothing on an untouched form, explains a field once it is left, and clears the problem when corrected', async () => {
    await renderForm();
    const name = field('Schedule name');
    expect(container.querySelector('[aria-invalid="true"]')).toBeNull();

    await type(name, '   ');
    expect(errorOf(name)).toBeUndefined();
    await leave(name);
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(errorOf(name)).toBe('Schedule name is required');

    await type(name, 'Weekly backup');
    expect(name.hasAttribute('aria-invalid')).toBe(false);
    expect(errorOf(name)).toBeUndefined();
  });

  it('keeps blank and partial entries as typed, checks them on Create and focuses the first problem', async () => {
    await renderForm();
    const time = field('Local run time');
    const runs = field('Runs to retain');
    const days = field('Retention days');
    await type(time, '');
    await type(runs, '');
    await type(days, '4000');
    expect(runs.value).toBe('');

    await click(button('Create schedule'));

    expect(mocks.post).not.toHaveBeenCalled();
    expect(errorOf(time)).toBe('Local run time is required');
    expect(errorOf(runs)).toBe('Runs to retain is required');
    expect(errorOf(days)).toBe('Enter a whole number from 1 to 3650.');
    expect(document.activeElement).toBe(time);

    // Pressing Create doesn't blur the field first, so an error appearing above can't shift the button from under the click.
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    await act(async () => button('Create schedule')?.dispatchEvent(press));
    expect(press.defaultPrevented).toBe(true);

    await type(time, '06:30');
    await type(runs, '5');
    await type(days, '30');
    expect(container.querySelector('[aria-invalid="true"]')).toBeNull();
    mocks.post.mockResolvedValue(created());
    await click(button('Create schedule'));
    expect(sentBodies()).toEqual([expect.objectContaining({ hour: 6, minute: 30, retentionCount: 5, retentionDays: 30 })]);
  });

  it('reports every problem on Create, also those in fields never left, when another field already shows one', async () => {
    await renderForm();
    const name = field('Schedule name');
    const time = field('Local run time');
    await type(name, '');
    await leave(name);
    await type(time, '');
    expect(errorOf(time)).toBeUndefined();

    await click(button('Create schedule'));

    expect(errorOf(name)).toBe('Schedule name is required');
    expect(errorOf(time)).toBe('Local run time is required');
    expect(document.activeElement).toBe(name);
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('sends only the active day, requires it, and lets a hidden one go', async () => {
    await renderForm();
    await choose(field<HTMLElement>('Schedules'), 'Monthly');
    const monthday = field('Day of month');
    await type(monthday, '');
    await click(button('Create schedule'));
    expect(errorOf(monthday)).toBe('Day of month is required');
    expect(mocks.post).not.toHaveBeenCalled();

    // The blank day of month is hidden by a daily cadence: it no longer blocks Create and is not sent.
    await choose(field<HTMLElement>('Schedules'), 'Daily');
    mocks.post.mockResolvedValue(created());
    await click(button('Create schedule'));
    expect(sentBodies()).toHaveLength(1);
    expect(sentBodies()[0]).not.toHaveProperty('monthday');
    expect(sentBodies()[0]).not.toHaveProperty('weekday');
  });

  it('sends the weekday chosen for a weekly schedule', async () => {
    mocks.post.mockResolvedValue(created());
    await renderForm();
    await choose(field<HTMLElement>('Schedules'), 'Weekly');
    await choose(field<HTMLElement>('Weekday'), 'Friday');
    await click(button('Create schedule'));
    expect(sentBodies()).toEqual([expect.objectContaining({ cadence: 'WEEKLY', weekday: 5 })]);
    expect(sentBodies()[0]).not.toHaveProperty('monthday');
  });

  it('keeps one format, says why the last one is locked, and sends formats in the order chosen', async () => {
    mocks.post.mockResolvedValue(created());
    await renderForm();
    const [markdown, pdf, html] = [...container.querySelectorAll<HTMLElement>('[role="switch"]')];
    await click(markdown);
    await click(pdf);
    expect(html?.getAttribute('aria-disabled')).toBe('true');
    expect(html?.getAttribute('aria-checked')).toBe('true');
    expect(document.getElementById(html?.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Keep at least one format.');
    await click(html);
    await click(markdown);
    await click(button('Create schedule'));
    expect(sentBodies()[0].formats).toEqual(['STATIC_HTML', 'MARKDOWN']);
  });

  it('labels every field with a unique id in each instance and keeps timezones left-to-right', async () => {
    await act(async () =>
      root.render(
        wrap(
          <>
            <ScheduleCreateForm onCreated={onCreated} projectId="site-a" />
            <ScheduleCreateForm onCreated={onCreated} projectId="site-a" />
          </>,
        ),
      ),
    );
    const ids = [...container.querySelectorAll('input, button[role="combobox"], button[role="switch"]')].map((node) => node.id).filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
    expect(field<HTMLElement>('IANA timezone').getAttribute('dir')).toBe('ltr');
    expect(field('Local run time').getAttribute('dir')).toBe('ltr');
  });
});

describe('when creation fails', () => {
  it('keeps everything typed, shows the schedule limit for 409, and creates on retry', async () => {
    mocks.post.mockResolvedValueOnce(json(409, { error: { message: 'At most 20 archive schedules may be configured per project.' } }));
    await renderForm();
    await type(field('Schedule name'), 'Quarterly archive');
    await type(field('Runs to retain'), '40');
    await click(button('Create schedule'));

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'This site already has the most schedules allowed. Remove one to add another.',
    );
    expect(mocks.error).not.toHaveBeenCalled();
    expect(field('Schedule name').value).toBe('Quarterly archive');
    expect(field('Runs to retain').value).toBe('40');
    expect(field('Schedule name').disabled).toBe(false);
    expect(onCreated).not.toHaveBeenCalled();
    expect(dirtyNow()).toBe(true);

    mocks.post.mockResolvedValueOnce(created());
    await click(button('Create schedule'));
    expect(sentBodies()).toHaveLength(2);
    expect(sentBodies()[1]).toEqual(sentBodies()[0]);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(onCreated).toHaveBeenCalledOnce();
  });

  it('says one general thing for another failure', async () => {
    mocks.post.mockResolvedValueOnce(json(500, { error: { message: 'Internal error' } }));
    await renderForm();
    await click(button('Create schedule'));
    expect(container.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Could not save');
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('reports a created schedule even when the list refresh fails, and never sends it twice', async () => {
    mocks.post.mockResolvedValue(created());
    const listFetch = vi.fn().mockResolvedValueOnce([]).mockRejectedValue(new Error('offline'));
    function ScheduleList() {
      useQuery({ queryKey: ['projects', 'site-a', 'exports', 'schedules'], queryFn: listFetch });
      return null;
    }
    await act(async () =>
      root.render(
        wrap(
          <>
            <ScheduleList />
            <ScheduleCreateForm onCreated={onCreated} projectId="site-a" />
          </>,
        ),
      ),
    );
    await click(button('Create schedule'));
    await act(async () => undefined);

    expect(listFetch).toHaveBeenCalledTimes(2);
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith('Archive schedule created.');
    expect(onCreated).toHaveBeenCalledOnce();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('the draft and its site', () => {
  it('takes its defaults once: a language change neither renames nor dirties it', async () => {
    await renderForm();
    expect(dirtyNow()).toBe(false);
    mocks.locale = 'ar';
    await renderForm();
    expect(field('اسم الجدول').value).toBe('Nightly archive');
    expect(dirtyNow()).toBe(false);

    await type(field('اسم الجدول'), 'نسخة ليلية');
    expect(dirtyNow()).toBe(true);
    mocks.locale = 'en';
    await renderForm();
    expect(field('Schedule name').value).toBe('نسخة ليلية');
    // Typing the default back makes it clean again.
    await type(field('Schedule name'), 'Nightly archive');
    expect(dirtyNow()).toBe(false);
    expect(onUnsettled).toHaveBeenLastCalledWith(false);
  });

  it('counts a pending creation as unsettled even with default values', async () => {
    const response = deferred();
    mocks.post.mockReturnValue(response.promise);
    await renderForm();
    expect(dirtyNow()).toBe(false);
    await click(button('Create schedule'));
    expect(dirtyNow()).toBe(true);
    expect(onUnsettled).toHaveBeenLastCalledWith(true);
    await act(async () => response.resolve(created()));
  });

  it('starts over for another site, and a request for the old one updates only its own lists', async () => {
    const response = deferred();
    mocks.post.mockReturnValue(response.promise);
    client.setQueryData(['projects', 'site-a', 'exports', 'schedules'], []);
    client.setQueryData(['projects', 'site-b', 'exports', 'schedules'], []);
    await renderForm('site-a');
    await type(field('Schedule name'), 'Site A archive');
    await click(button('Create schedule'));

    // The same form instance now edits site B: nothing typed for site A carries over.
    await renderForm('site-b');
    expect(field('Schedule name').value).toBe('Nightly archive');
    expect(field('Schedule name').disabled).toBe(false);

    await act(async () => response.resolve(created('site-a')));
    expect(mocks.post).toHaveBeenCalledWith(expect.objectContaining({ param: { projectId: 'site-a' } }));
    expect(client.getQueryState(['projects', 'site-a', 'exports', 'schedules'])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['projects', 'site-b', 'exports', 'schedules'])?.isInvalidated).toBe(false);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(field('Schedule name').value).toBe('Nightly archive');
  });

  it('keeps a remounted A → B → A form clear of the first draft and its late result', async () => {
    const success = deferred();
    const failure = deferred();
    mocks.post.mockReturnValueOnce(success.promise).mockReturnValueOnce(failure.promise);
    client.setQueryData(['projects', 'site-a', 'exports', 'schedules'], []);
    await renderForm('site-a', { key: 'site-a' });
    await type(field('Schedule name'), 'First A draft');
    await click(button('Create schedule'));
    await renderForm('site-b', { key: 'site-b' });
    await type(field('Schedule name'), 'B draft');
    await click(button('Create schedule'));
    await renderForm('site-a', { key: 'site-a' });

    expect(field('Schedule name').value).toBe('Nightly archive');
    expect(field('Schedule name').disabled).toBe(false);
    expect(dirtyNow()).toBe(false);

    await act(async () => success.resolve(created('site-a')));
    await act(async () => failure.resolve(json(500, { error: { message: 'Internal error' } })));

    // The server's write and the old site's cache refresh still happen; the old forms say and do nothing.
    expect(client.getQueryState(['projects', 'site-a', 'exports', 'schedules'])?.isInvalidated).toBe(true);
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(field('Schedule name').value).toBe('Nightly archive');
    expect(document.activeElement).toBe(document.body);
  });
});

describe('inside the exports section', () => {
  const openForm = async () => {
    await renderSection();
    await click(button('Schedules'));
    await click(button('New schedule'));
  };

  it('closes an untouched form without asking', async () => {
    await openForm();
    expect(button('New schedule')?.getAttribute('aria-expanded')).toBe('true');
    await click(button('New schedule'));
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(button('Create schedule')).toBeUndefined();
  });

  it('asks before an edited draft is closed or left for another surface, and keeps it when the person stays', async () => {
    await openForm();
    await type(field('Schedule name'), 'Edited');
    mocks.confirm.mockResolvedValue(false);

    await click(button('Run history'));
    await click(button('New schedule'));
    expect(mocks.confirm).toHaveBeenCalledTimes(2);
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Leave without saving?' }));
    expect(field('Schedule name').value).toBe('Edited');

    mocks.confirm.mockResolvedValue(true);
    await click(button('Run history'));
    expect(button('Create schedule')).toBeUndefined();
    expect(dirtyNow()).toBe(false);
  });

  it('treats a pending creation as unsettled, and a discarded one still finishes quietly', async () => {
    const response = deferred();
    mocks.post.mockReturnValue(response.promise);
    await openForm();
    await click(button('Create schedule'));
    mocks.confirm.mockResolvedValue(true);

    await click(button('New schedule'));
    expect(mocks.confirm).toHaveBeenCalledOnce();
    expect(button('Creating schedule…')).toBeUndefined();

    await act(async () => response.resolve(created()));
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('closes the form once after it creates the schedule', async () => {
    mocks.post.mockResolvedValue(created());
    await openForm();
    await click(button('Create schedule'));
    expect(mocks.success).toHaveBeenCalledOnce();
    expect(button('Create schedule')).toBeUndefined();
    expect(button('New schedule')?.getAttribute('aria-expanded')).toBe('false');
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  // These two ran unchanged against main (176033a4), where both fail: see .github/assets/export-schedule-create/README.md.
  describe('regressions from main', () => {
    const render = renderSection;
    it('keeps a pristine draft clean when the dashboard language changes', async () => {
      await render();
      await act(async () => button('Schedules')?.click());
      await act(async () => button('New schedule')?.click());
      expect(dirtyNow()).toBe(false);

      mocks.locale = 'ar';
      await render();

      expect(dirtyNow()).toBe(false);
      expect((container.querySelector('input[maxlength], input') as HTMLInputElement).value).toBe('Nightly archive');
    });

    it('lets a number field stay blank instead of turning it into 0', async () => {
      await render();
      await act(async () => button('Schedules')?.click());
      await act(async () => button('New schedule')?.click());
      const runs = [...container.querySelectorAll('label')].find((label) => label.textContent?.includes('Runs to retain'));
      const input = document.getElementById(runs?.getAttribute('for') ?? '') as HTMLInputElement;
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      await act(async () => {
        setValue?.call(input, '');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });

      expect(input.value).toBe('');
    });
  });
});
