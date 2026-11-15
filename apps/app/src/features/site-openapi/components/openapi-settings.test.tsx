// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigDirtyProvider } from '@/components/project-settings/shared';
import type { OpenApiConfiguration } from '@/hooks/api';
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

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let dirty: Set<string>;

/** Renders (or re-renders, as a refetch does) with whatever the server currently holds. */
const render = () =>
  act(async () =>
    root.render(
      <ConfigDirtyProvider report={(id, changed) => (changed ? dirty.add(id) : dirty.delete(id))}>
        <OpenApiSettings projectId="site-1" />
      </ConfigDirtyProvider>,
    ),
  );
/** The server's configuration changes and the query refetches it. */
const refetch = (next: OpenApiConfiguration | null) => {
  mocks.data = next;
  return render();
};

beforeEach(() => {
  mocks.data = saved;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  dirty = new Set();
});

afterEach(async () => {
  await act(async () => root.unmount());
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
});
