// @vitest-environment jsdom
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { updateLanguageBody, updateProjectBody } from '@nibleaf/validators';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigDirtyProvider } from '@/components/project-settings/shared';
import { BannerSettings } from '@/features/site-banner/components/banner-settings';
import { projectQueryOptions } from '@/hooks/api/query-options';

const mocks = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, translateFn: (key: string) => key }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
vi.mock('@/services/api-origin', () => ({ apiOrigin: () => 'http://dashboard.test' }));
vi.mock('@tanstack/react-router', () => ({ useBlocker: () => undefined }));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const SITE = '00000000-0000-4000-8000-000000000001';
const ENGLISH = '00000000-0000-4000-8000-000000000002';
const FRENCH = '00000000-0000-4000-8000-000000000003';
const BANNER = { enabled: true, dismissible: true, message: 'Spring sale', linkLabel: '', linkUrl: '' };
const PROJECT_PATH = `/api/app/projects/${SITE}`;
const FRENCH_PATH = `${PROJECT_PATH}/languages/${FRENCH}`;

type Entry = { method: string; path: string; body?: unknown };

/**
 * The API behind the real client. A PATCH whose path is in `hold` waits until
 * the test releases it; everything else answers at once. Every request is
 * logged when it arrives, before it is answered.
 */
function fakeApi() {
  const server = {
    banner: structuredClone(BANNER) as Record<string, unknown>,
    french: null as unknown,
    log: [] as Entry[],
    hold: new Set<string>(),
    held: new Map<string, () => void>(),
  };
  const project = () => ({ id: SITE, name: 'Acme', config: { banner: structuredClone(server.banner) } });
  const languages = () => [
    { id: ENGLISH, code: 'en', label: 'English', direction: 'LTR', enabled: true, isDefault: true, position: 0, config: null },
    { id: FRENCH, code: 'fr', label: 'Français', direction: 'LTR', enabled: true, isDefault: false, position: 1, config: server.french },
  ];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      const body = request.method === 'PATCH' ? await request.json() : undefined;
      server.log.push({ method: request.method, path, body });
      if (request.method === 'PATCH' && server.hold.has(path)) {
        server.hold.delete(path);
        await new Promise<void>((resolve) => server.held.set(path, resolve));
      }
      if (path === PROJECT_PATH && request.method === 'PATCH') {
        server.banner = { ...server.banner, ...(updateProjectBody.parse(body).config?.banner as object) };
        return Response.json({ data: project() });
      }
      if (path === PROJECT_PATH) return Response.json({ data: project() });
      if (path === `${PROJECT_PATH}/languages`) return Response.json({ data: languages() });
      if (path === FRENCH_PATH && request.method === 'PATCH') {
        server.french = updateLanguageBody.parse(body).config ?? null;
        return Response.json({ data: languages()[1] });
      }
      return Response.json({ error: { message: `Unexpected ${request.method} ${path}` } }, { status: 404 });
    }),
  );
  return server;
}

/** The settings page: the project from its query, as the route passes it. */
function Page() {
  const { data } = useQuery(projectQueryOptions(SITE));
  return data ? <BannerSettings project={data} /> : null;
}

let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let server: ReturnType<typeof fakeApi>;

beforeEach(async () => {
  server = fakeApi();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ConfirmProvider>
          <ConfigDirtyProvider report={() => undefined}>
            <Page />
          </ConfigDirtyProvider>
        </ConfirmProvider>
      </QueryClientProvider>,
    ),
  );
  await act(() => vi.waitFor(() => expect(scopeButton('Français')).toBeDefined()));
});

afterEach(async () => {
  for (const release of server.held.values()) release();
  await act(async () => root.unmount());
  container.remove();
  document.body.replaceChildren();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

const buttons = (scope: ParentNode = document) => [...scope.querySelectorAll('button')];
const scopeButton = (label: string) => buttons(container).find((button) => button.textContent?.trim().startsWith(label));
const region = () => document.querySelector<HTMLElement>('[data-slot="save-region"]');
const saveButton = () => {
  const found = buttons(region() ?? undefined).find((button) => button.textContent?.trim().startsWith('common.save'));
  if (!found) throw new Error('No Save in the bar');
  return found;
};
const message = () => {
  const label = [...container.querySelectorAll('label')].find((item) => item.textContent === 'settings.banner.message.label');
  const input = label && document.getElementById(label.htmlFor);
  if (!(input instanceof HTMLInputElement)) throw new Error('No message field');
  return input;
};
const type = (input: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
const settle = () => act(async () => vi.waitFor(() => undefined));
const click = async (element: HTMLElement) => {
  await act(async () => element.click());
  await settle();
};
const switchTo = async (label: string) => {
  const button = scopeButton(label);
  if (!button) throw new Error(`No scope ${label}`);
  await click(button);
  const dialog = document.querySelector<HTMLElement>('[role="alertdialog"], [role="dialog"]');
  const confirm = dialog && buttons(dialog).find((item) => item.textContent?.trim().startsWith('settings.chrome.scope.discardConfirm'));
  if (confirm) await click(confirm);
};
const patches = () => server.log.filter((entry) => entry.method === 'PATCH').map((entry) => entry.path);
const release = async (path: string) => {
  await act(async () => server.held.get(path)?.());
  await act(() => vi.waitFor(() => expect(server.log.filter((entry) => entry.method === 'GET').length).toBeGreaterThan(0)));
  await settle();
};

describe('Banner scope switch with the Default save in flight (#770)', () => {
  it("sends French's first Save at once, and the Default save's late end leaves French alone", async () => {
    server.hold.add(PROJECT_PATH);
    await type(message(), 'Default sale');
    await click(saveButton());
    expect(patches()).toEqual([PROJECT_PATH]);

    await switchTo('Français');
    await type(message(), 'Soldes');
    expect(saveButton().disabled).toBe(false);
    server.hold.add(FRENCH_PATH);
    await click(saveButton());
    // The new scope's first Save sends its own request while the old one is still pending.
    expect(patches()).toEqual([PROJECT_PATH, FRENCH_PATH]);
    expect(server.log.at(-1)?.body).toEqual({ config: { banner: { message: 'Soldes' } } });

    // A second press while French's save runs sends nothing.
    await click(saveButton());
    expect(patches()).toEqual([PROJECT_PATH, FRENCH_PATH]);

    // The Default save ends: French is still saving, keeps its text, and nothing is said.
    await release(PROJECT_PATH);
    expect(message().value).toBe('Soldes');
    expect(region()).not.toBeNull();
    expect(saveButton().disabled).toBe(true);
    expect(region()?.textContent).not.toContain('common.saved');
    expect(mocks.toastError).not.toHaveBeenCalled();

    await release(FRENCH_PATH);
    expect(server.french).toEqual({ banner: { message: 'Soldes' } });
    expect(message().value).toBe('Soldes');
    expect(region()).toBeNull();
    expect(patches()).toEqual([PROJECT_PATH, FRENCH_PATH]);
  });
});
