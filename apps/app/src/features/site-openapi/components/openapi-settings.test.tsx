// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigDirtyProvider } from '@/components/project-settings/shared';
import type { OpenApiConfiguration } from '@/hooks/api';
import { queryKeys } from '@/hooks/api/query-keys';
import { OpenApiSettings } from './openapi-settings';

const mocks = vi.hoisted(() => ({
  data: null as OpenApiConfiguration | null,
  upsert: vi.fn(),
  sync: vi.fn(),
  remove: vi.fn(),
  confirm: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, translateFn: (key: string) => key }));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => mocks.confirm }));
vi.mock('@/hooks/api', () => ({
  useOpenApiConfiguration: () => ({ data: mocks.data, isPending: false, isError: false, isFetching: false, refetch: vi.fn() }),
  useUpsertOpenApi: () => ({ mutateAsync: mocks.upsert, isPending: false }),
  useSyncOpenApi: () => ({ mutateAsync: mocks.sync, isPending: false }),
  useDeleteOpenApi: () => ({ mutateAsync: mocks.remove, isPending: false }),
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const saved: OpenApiConfiguration = {
  title: 'Payments API',
  path: 'payments',
  contentHash: 'hash-1',
  updatedAt: '2026-11-01T10:00:00.000Z',
  source: { type: 'url', url: 'https://api.example.com/openapi.yaml' },
};

let queryClient: QueryClient;
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let dirty: Set<string>;

/** Renders (or re-renders, as a refetch does) with whatever the server currently holds. */
const render = () =>
  act(async () =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <ConfigDirtyProvider report={(id, changed) => (changed ? dirty.add(id) : dirty.delete(id))}>
          <OpenApiSettings projectId="site-1" />
        </ConfigDirtyProvider>
      </QueryClientProvider>,
    ),
  );
/** The server's configuration changes and the query refetches it. */
const refetch = (next: OpenApiConfiguration | null) => {
  mocks.data = next;
  queryClient.setQueryData(queryKeys.openapi.detail('site-1'), next);
  return render();
};

beforeEach(() => {
  mocks.data = saved;
  queryClient = new QueryClient();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  dirty = new Set();
});

afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  container.remove();
  vi.clearAllMocks();
});

const field = (id: string) => {
  const el = container.querySelector(`#${id}`);
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) throw new Error(`No #${id}`);
  return el;
};
const button = (key: string) => {
  const found = [...container.querySelectorAll('button')].find((el) => el.textContent?.includes(key));
  if (!found) throw new Error(`No button ${key}`);
  return found;
};
const click = (key: string) => act(async () => button(key).click());
const type = (el: HTMLInputElement | HTMLTextAreaElement, text: string) =>
  act(async () => {
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

/** Makes the next save wait until the test settles it. */
function pendingSave() {
  const control: { finish: () => void; fail: (error: unknown) => void } = { finish: () => undefined, fail: () => undefined };
  mocks.upsert.mockImplementation(
    () =>
      new Promise<void>((resolve, reject) => {
        control.finish = resolve;
        control.fail = reject;
      }),
  );
  return control;
}

describe('OpenApiSettings draft', () => {
  it('keeps the edits being made when a refetch brings other server changes', async () => {
    await render();
    await click('settings.openapi.edit');
    await type(field('openapi-title'), 'Billing API');
    expect(dirty.size).toBe(1);

    await refetch({ ...saved, path: 'payments-v2', contentHash: 'hash-2', updatedAt: '2026-11-02T10:00:00.000Z' });

    expect(field('openapi-title').value).toBe('Billing API');
    // A field the person didn't touch follows the server.
    expect(field('openapi-path').value).toBe('payments-v2');
    expect(dirty.size).toBe(1);
    expect(container.textContent).not.toContain('forms.changedElsewhere');
  });

  it('keeps an edit the server also changed, and says so', async () => {
    await render();
    await click('settings.openapi.edit');
    await type(field('openapi-title'), 'Mine');

    await refetch({ ...saved, title: 'Theirs' });

    expect(field('openapi-title').value).toBe('Mine');
    expect(container.textContent).toContain('forms.changedElsewhere');
    await click('forms.useTheirs');
    expect(field('openapi-title').value).toBe('Theirs');
    expect(dirty.size).toBe(0);
  });

  it('takes the server values again once a save is confirmed', async () => {
    mocks.upsert.mockResolvedValue({});
    await render();
    await click('settings.openapi.edit');
    await type(field('openapi-title'), '  Billing API ');
    await type(field('openapi-path'), 'Billing');
    await click('common.save');

    expect(mocks.upsert).toHaveBeenCalledWith({
      title: 'Billing API',
      path: 'Billing',
      source: { type: 'url', url: 'https://api.example.com/openapi.yaml' },
    });
    expect(mocks.toastSuccess).toHaveBeenCalledWith('settings.openapi.saved');
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(dirty.size).toBe(0);
    // The editor closes on success, as before.
    expect(container.querySelector('#openapi-title')).toBeNull();

    // The invalidation refetches what the server stored, normalized its own way.
    await refetch({ ...saved, title: 'Billing API', path: 'billing', contentHash: 'hash-2' });
    expect(container.textContent).toContain('/billing');
    await click('settings.openapi.edit');
    expect(field('openapi-title').value).toBe('Billing API');
    expect(field('openapi-path').value).toBe('billing');
    expect(dirty.size).toBe(0);
  });

  it('re-syncs from the server when its refetch lands before the save resolves', async () => {
    const save = pendingSave();
    await render();
    await click('settings.openapi.edit');
    await type(field('openapi-path'), 'Billing');
    await act(async () => void button('common.save').click());

    // The mutation's invalidation refetches first: the server stored the path its own way.
    await refetch({ ...saved, path: 'billing', contentHash: 'hash-2' });
    await act(async () => save.finish());
    await render();

    expect(mocks.toastSuccess).toHaveBeenCalledWith('settings.openapi.saved');
    expect(container.querySelector('#openapi-title')).toBeNull();
    expect(container.textContent).toContain('/billing');
    expect(dirty.size).toBe(0);
    await click('settings.openapi.edit');
    expect(field('openapi-path').value).toBe('billing');
    expect(container.textContent).not.toContain('forms.changedElsewhere');
  });

  it('takes "no reference" when the refetch before the save resolves finds it removed', async () => {
    const save = pendingSave();
    await render();
    await click('settings.openapi.edit');
    await type(field('openapi-title'), 'Billing API');
    await act(async () => void button('common.save').click());

    // Another admin removed the reference; the refetch that follows the save says so.
    await refetch(null);
    await act(async () => save.finish());
    await render();

    expect(container.textContent).toContain('settings.openapi.emptyTitle');
    expect(dirty.size).toBe(0);
    await click('settings.openapi.add');
    expect(field('openapi-title').value).toBe('settings.openapi');
    expect(field('openapi-path').value).toBe('api-reference');
  });

  it('closes the editor only over a settled draft: a title someone else saved during the save stays open, with the conflict', async () => {
    const save = pendingSave();
    await render();
    await click('settings.openapi.edit');
    await type(field('openapi-title'), 'Sent');
    await act(async () => void button('common.save').click());
    // Someone else's title reaches the form while the save is in flight; a later fetch then fails,
    // so the save confirms what it sent.
    await refetch({ ...saved, title: 'Theirs', contentHash: 'hash-2' });
    act(() =>
      queryClient
        .getQueryCache()
        .find({ queryKey: queryKeys.openapi.detail('site-1') })
        ?.setState({ status: 'error', error: new Error('offline') }),
    );
    await act(async () => save.finish());
    await render();

    expect(mocks.toastSuccess).toHaveBeenCalledWith('settings.openapi.saved');
    const editorOpen = container.querySelector('#openapi-title') !== null;
    // The leave guard reports a draft only while the editor shows it.
    expect(dirty.size).toBe(editorOpen ? 1 : 0);
    if (editorOpen) {
      expect(field('openapi-title').value).toBe('Sent');
      expect(container.textContent).toContain('forms.changedElsewhere');
      await click('forms.useTheirs');
      expect(field('openapi-title').value).toBe('Theirs');
      expect(dirty.size).toBe(0);
    }
  });

  it('keeps Cancel disabled while saving, so a failed save leaves later edits in view', async () => {
    const save = pendingSave();
    mocks.toastError.mockClear();
    await render();
    await click('settings.openapi.edit');
    await type(field('openapi-title'), 'Billing API');
    await act(async () => void button('common.save').click());

    expect(button('common.cancel').disabled).toBe(true);
    await type(field('openapi-path'), 'billing');
    await click('common.cancel');
    expect(field('openapi-title').value).toBe('Billing API');

    await act(async () => save.fail(new Error('boom')));
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(button('common.cancel').disabled).toBe(false);
    expect(field('openapi-title').value).toBe('Billing API');
    expect(field('openapi-path').value).toBe('billing');
    expect(dirty.size).toBe(1);
    // Once it settled, Cancel discards as usual.
    await click('common.cancel');
    expect(dirty.size).toBe(0);
  });

  it('never sends a document as a URL after the server switched to one', async () => {
    mocks.data = { ...saved, source: { type: 'upload' } };
    mocks.upsert.mockResolvedValue({});
    await render();
    await click('settings.openapi.edit');
    await type(container.querySelector('textarea') as HTMLTextAreaElement, 'openapi: 3.1.0');

    await refetch({ ...saved, contentHash: 'hash-2' });
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('openapi: 3.1.0');
    expect(container.textContent).toContain('forms.changedElsewhere');
    await click('forms.keepMine');
    await click('common.save');

    expect(mocks.upsert).toHaveBeenCalledWith({ title: 'Payments API', path: 'payments', source: { type: 'upload', content: 'openapi: 3.1.0' } });
  });

  it('empties an uploaded document after saving it', async () => {
    mocks.data = null;
    mocks.upsert.mockResolvedValue({});
    await render();
    await click('settings.openapi.add');
    await type(field('openapi-title'), 'Payments API');
    await type(container.querySelector('textarea') as HTMLTextAreaElement, 'openapi: 3.1.0');
    await click('common.save');

    expect(mocks.upsert).toHaveBeenCalledWith({
      title: 'Payments API',
      path: 'api-reference',
      source: { type: 'upload', content: 'openapi: 3.1.0' },
    });
    await refetch({ ...saved, path: 'api-reference', source: { type: 'upload' } });
    await click('settings.openapi.edit');
    expect((container.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
    expect(dirty.size).toBe(0);
  });

  it('keeps the edits after a failed save and reports the failure once', async () => {
    mocks.upsert.mockRejectedValue(new Error('boom'));
    await render();
    await click('settings.openapi.edit');
    await type(field('openapi-title'), 'Billing API');
    await click('common.save');

    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith('settings.openapi.saveError');
    expect(field('openapi-title').value).toBe('Billing API');
    expect(dirty.size).toBe(1);
  });

  it('discards the draft on Cancel', async () => {
    await render();
    await click('settings.openapi.edit');
    await type(field('openapi-title'), 'Billing API');
    await click('common.cancel');

    expect(dirty.size).toBe(0);
    await click('settings.openapi.edit');
    expect(field('openapi-title').value).toBe('Payments API');
  });

  it('syncs a URL source and reports its failure once', async () => {
    mocks.sync.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('boom'));
    await render();
    await click('settings.openapi.sync');
    expect(mocks.toastSuccess).toHaveBeenCalledWith('settings.openapi.synced');
    await click('settings.openapi.sync');
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    expect(mocks.toastError).toHaveBeenCalledWith('settings.openapi.syncError');
  });

  it('removes the reference after confirming, then starts a new one from the defaults', async () => {
    mocks.confirm.mockResolvedValue(true);
    mocks.remove.mockImplementation(async () => {
      mocks.data = null;
    });
    await render();
    await click('settings.openapi.edit');
    await type(field('openapi-title'), 'Billing API');
    await click('settings.openapi.remove');
    // The invalidation's refetch delivers "no reference".
    await render();

    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    expect(mocks.toastSuccess).toHaveBeenCalledWith('settings.openapi.deleted');
    expect(container.textContent).toContain('settings.openapi.emptyTitle');
    expect(dirty.size).toBe(0);
    await click('settings.openapi.add');
    expect(field('openapi-title').value).toBe('settings.openapi');
    expect(field('openapi-path').value).toBe('api-reference');
  });

  it('removes nothing when the confirmation is declined', async () => {
    mocks.confirm.mockResolvedValue(false);
    await render();
    await click('settings.openapi.remove');
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it.each(['succeeds', 'fails'] as const)(
    'a save that %s after the section unmounted says nothing and leaves the new editor open with its edit (#767)',
    async (ending) => {
      const pending = pendingSave();
      await render();
      await click('settings.openapi.edit');
      await type(field('openapi-title'), 'Billing API');
      await click('common.save');
      expect(mocks.upsert).toHaveBeenCalledTimes(1);
      // Another site loading in its place, then back: a new section.
      await act(async () => root.render(<QueryClientProvider client={queryClient}>{null}</QueryClientProvider>));
      await render();
      await click('settings.openapi.edit');
      await type(field('openapi-title'), 'Ledger API');
      await act(async () => (ending === 'succeeds' ? pending.finish() : pending.fail(new Error('boom'))));
      expect(mocks.toastSuccess).not.toHaveBeenCalled();
      expect(mocks.toastError).not.toHaveBeenCalled();
      expect(field('openapi-title').value).toBe('Ledger API');
      expect(dirty.size).toBe(1);
    },
  );
});
