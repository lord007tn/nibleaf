// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SiteAi } from '../model/ai';

/*
 * Site settings → AI answers, every state of operations/ux/ai-and-integrations.md
 * §5.1 on both kinds of server (Nibleaf AI offered, or own keys only), with the
 * real design-system components and the server's answers as fixtures.
 */

const mocks = vi.hoisted(() => ({
  query: { isPending: false, isFetching: false, data: undefined as unknown, refetch: vi.fn() },
  access: 'admin' as 'admin' | 'notAdmin' | 'pending',
  select: { isPending: false, mutate: vi.fn() },
  prepare: { isPending: false, mutate: vi.fn() },
  toast: vi.fn(),
}));
vi.mock('../api/hooks', () => ({
  useSiteAi: () => mocks.query,
  useSelectAiSource: () => mocks.select,
  usePrepareDocsForAi: () => mocks.prepare,
}));
vi.mock('./provider-key-form', () => ({
  ProviderKeyForm: ({ providerId }: { providerId: string }) => <div data-key-form={providerId} />,
}));
vi.mock('@/hooks/use-project-admin-status', () => ({ useProjectAdminStatus: () => ({ status: mocks.access }) }));
vi.mock('@/components/query-error-state', () => ({ QueryErrorState: () => <p>load-error</p> }));
vi.mock('sonner', () => ({ toast: { success: mocks.toast, error: vi.fn() } }));
vi.mock('@nibleaf/i18n/react', () => ({
  useLocale: () => ({ locale: 'en', t: (key: string, values?: Record<string, unknown>) => (values ? `${key}${JSON.stringify(values)}` : key) }),
  useT: () => (key: string) => key,
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, search, ...props }: { children?: ReactNode; to: string; search?: { section?: string } } & Record<string, unknown>) => (
    <a {...(props as object)} href={`${to}${search?.section ? `?section=${search.section}` : ''}`}>
      {children}
    </a>
  ),
}));

import { AiAnswersPage } from './ai-answers-page';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
// base-ui's switch and radio measure themselves.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  },
);
Element.prototype.scrollIntoView = vi.fn();

type Overrides = { capabilities?: Partial<SiteAi['capabilities']>; status?: Partial<SiteAi['status']> };
const key = (id: 'openai' | 'openrouter', state: SiteAi['status']['connections'][number]['state'] = 'ok') => ({
  id,
  revision: 3,
  state,
  failure: null,
  keyHint: '4f2a',
  addedAt: '2026-11-10T09:00:00.000Z',
  model: { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
});
/** A Cloud-like server: Nibleaf AI and own keys. The site is published and prepared; answers off. */
const cloud = (overrides: Overrides = {}): SiteAi => ({
  capabilities: {
    managed: { available: true, reason: null, model: { id: 'openai/gpt-6-luna', label: 'GPT-6 Luna' }, dailyAnswerLimit: 200 },
    ownKey: { available: true, reason: null },
    providers: [
      { id: 'openai', available: true, reason: null },
      { id: 'openrouter', available: true, reason: null },
    ],
    answers: { available: true, reason: null },
    ...overrides.capabilities,
  },
  status: {
    answersOn: false,
    source: 'managed',
    sourceReady: true,
    connections: [],
    published: { version: 12, at: '2026-11-11T08:00:00.000Z' },
    preparation: { state: 'ready', pages: 128, expectedPages: 128, at: '2026-11-11T08:05:00.000Z' },
    usage: { answersToday: 37, spent: 40, limit: 200, resetsAt: '2026-11-12T00:00:00.000Z' },
    ...overrides.status,
  },
  viewer: { canManage: true },
});
/** A self-host-like server: own keys only. */
const selfHosted = (overrides: Overrides = {}) =>
  cloud({
    ...overrides,
    capabilities: { managed: { available: false, reason: 'noServerKey', model: null, dailyAnswerLimit: 200 }, ...overrides.capabilities },
  });
const on = { answersOn: true };

let root: ReturnType<typeof createRoot> | undefined;
const show = async (data: unknown, pending = false) => {
  Object.assign(mocks.query, { data, isPending: pending });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<AiAnswersPage project={{ id: 'site' } as never} />));
  return container;
};
const text = () => document.body.textContent ?? '';
const theSwitch = () => document.querySelector<HTMLElement>('[role="switch"]');
const radios = () => [...document.querySelectorAll<HTMLElement>('[role="radio"]')];
const sources = () => [...document.querySelectorAll<HTMLElement>('[data-source]')].map((card) => card.getAttribute('data-source'));
const check = (id: string) => document.querySelector<HTMLElement>(`[data-check="${id}"]`);
const button = (label: string, scope: ParentNode = document) =>
  [...scope.querySelectorAll<HTMLElement>('button, a')].find((item) => item.textContent?.trim().startsWith(label));
const isDisabled = (element: HTMLElement | null | undefined) =>
  element?.hasAttribute('data-disabled') ||
  element?.getAttribute('aria-disabled') === 'true' ||
  (element as HTMLButtonElement | null)?.disabled === true;

beforeEach(() => {
  mocks.access = 'admin';
  mocks.select.isPending = false;
  mocks.prepare.isPending = false;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe('AI answers page states (§5.1)', () => {
  it('loading: shows the header at once over a skeleton shaped like the page', async () => {
    await show(undefined, true);
    expect(text()).toContain('settings.ai.description');
    const busy = document.querySelector('[aria-busy="true"]');
    expect(busy?.querySelector('[role="status"]')?.textContent).toBe('common.loading');
    expect(busy?.querySelectorAll('[data-skeleton="sources"] > *')).toHaveLength(3);
    expect(busy?.querySelectorAll('[data-skeleton="checks"] > *')).toHaveLength(4);
  });

  it('a failed load offers a retry', async () => {
    Object.assign(mocks.query, { isPending: false });
    await show(undefined);
    expect(text()).toContain('load-error');
  });

  it('unavailable: one sentence, no switch and no forms', async () => {
    await show(cloud({ capabilities: { answers: { available: false, reason: 'searchNotConfigured' } } }));
    expect(document.querySelector('[data-reason="notConfigured"]')?.textContent).toContain('settings.ai.reason.serverUnavailable');
    expect(text()).toContain('settings.ai.unavailable.description');
    expect(theSwitch()).toBeNull();
    expect(radios()).toHaveLength(0);
    expect(text()).not.toMatch(/operator|encryption|self-host/i);
  });

  it('off, Nibleaf AI offered: the switch works at once; Nibleaf AI shows its model and daily limit', async () => {
    await show(cloud());
    expect(theSwitch()?.getAttribute('aria-checked')).toBe('false');
    expect(isDisabled(theSwitch())).toBe(false);
    expect(text()).toContain('settings.ai.state.off');
    expect(text()).toContain('settings.ai.switch.off');
    expect(sources()).toEqual(['managed', 'openai', 'openrouter']);
    const managed = document.querySelector('[data-source="managed"]');
    expect(managed?.textContent).toContain('settings.ai.model{"model":"GPT-6 Luna"}');
    expect(managed?.textContent).toContain('settings.ai.dailyLimit{"limit":200}');
  });

  it('off, own keys only and none saved: the switch is disabled with its reason, and Nibleaf AI is not drawn', async () => {
    await show(selfHosted());
    expect(sources()).toEqual(['openai', 'openrouter']);
    expect(isDisabled(theSwitch())).toBe(true);
    expect(text()).toContain('settings.ai.reason.addKeyFirst');
    expect(button('settings.ai.key.add', document.querySelector('[data-source="openai"]') ?? document)).toBeDefined();
  });

  it('production today (no Nibleaf AI, no key, never prepared): nothing reads as broken, and the next step is adding a key', async () => {
    // The server still reports its default source (Nibleaf AI) though it doesn't offer it.
    await show(selfHosted({ status: { preparation: { state: 'none', pages: 0, expectedPages: 0, at: null } } }));
    // Each card names its own missing key, next to its Add key button.
    expect(document.querySelector('[data-source="openai"]')?.textContent).toContain('settings.ai.problem.keyMissing{"provider":"OpenAI"}');
    expect(document.querySelector('[data-source="openrouter"]')?.textContent).toContain('settings.ai.problem.keyMissing{"provider":"OpenRouter"}');
    expect(document.querySelectorAll('[data-check][data-tone="problem"]')).toHaveLength(0);
    expect(check('source')?.textContent).toContain('settings.ai.check.source.none');
    expect(check('source')?.textContent).not.toContain('settings.ai.check.source.managed');
    await act(async () => button('settings.ai.key.add', check('source') ?? document)?.click());
    expect(document.querySelector('[data-key-form="openai"]')).not.toBeNull();
    expect(text()).not.toMatch(/operator|encryption|self-host/i);
  });

  it('off, nothing published: the switch says to publish first, and the checklist links to the editor', async () => {
    await show(cloud({ status: { published: null } }));
    expect(isDisabled(theSwitch())).toBe(true);
    expect(text()).toContain('settings.ai.reason.publishFirst');
    expect(check('published')?.getAttribute('data-tone')).toBe('problem');
    expect(button('settings.ai.fix.publish', check('published') ?? document)?.getAttribute('href')).toBe('/app/projects/$projectId/editor');
  });

  it('on with Nibleaf AI: everything checked, with today’s usage and a way to try it', async () => {
    await show(cloud({ status: on }));
    expect(theSwitch()?.getAttribute('aria-checked')).toBe('true');
    expect(text()).toContain('settings.ai.state.on');
    expect(['published', 'prepared', 'source', 'usage'].map((id) => check(id)?.getAttribute('data-tone'))).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(check('usage')?.textContent).toContain('settings.ai.usage.meter{"used":"40","limit":"200"}');
    expect(check('usage')?.textContent).toContain('settings.ai.usage.answered{"answered":"37"}');
    expect(button('settings.ai.tryIt')?.getAttribute('href')).toBe('/sites/$projectId');
  });

  it('on with an own key: its hint, date, model and who pays', async () => {
    await show(cloud({ status: { ...on, source: 'openai', connections: [key('openai')] } }));
    const card = document.querySelector('[data-source="openai"]');
    expect(card?.textContent).toContain('settings.ai.key.works');
    expect(card?.textContent).toContain('settings.ai.key.hint{"hint":"⁦…4f2a⁩"}');
    expect(card?.textContent).toContain('settings.ai.key.added');
    expect(card?.textContent).toContain('settings.ai.whoPays{"provider":"OpenAI","limit":200}');
    expect(check('source')?.textContent).toContain('settings.ai.check.source.key{"provider":"OpenAI"}');
  });

  it('preparing: on, while the docs are being prepared', async () => {
    await show(cloud({ status: { ...on, preparation: { state: 'running', pages: 40, expectedPages: 128, at: null } } }));
    expect(text()).toContain('settings.ai.state.preparing');
    expect(text()).toContain('settings.ai.switch.preparing');
    expect(check('prepared')?.getAttribute('data-tone')).toBe('working');
    expect(check('prepared')?.textContent).toContain('settings.ai.check.preparingDetail{"pages":"40","expected":"128"}');
  });

  it('preparing, before the pages are counted: no "0 of 0"', async () => {
    await show(cloud({ status: { ...on, preparation: { state: 'running', pages: 0, expectedPages: 0, at: null } } }));
    expect(check('prepared')?.textContent).toContain('settings.ai.check.preparing');
    expect(check('prepared')?.textContent).not.toContain('settings.ai.check.preparingDetail');
  });

  it('partly prepared: answers stay on, with a warning and a way to try again', async () => {
    await show(cloud({ status: { ...on, preparation: { state: 'partial', pages: 125, expectedPages: 128, at: null } } }));
    expect(text()).toContain('settings.ai.state.on');
    expect(check('prepared')?.getAttribute('data-tone')).toBe('warning');
    expect(button('settings.ai.fix.prepare', check('prepared') ?? document)).toBeDefined();
  });

  it.each([
    {
      name: 'a refused key',
      status: { source: 'openai' as const, connections: [key('openai', 'rejected')] },
      problem: 'keyRejected',
      fix: 'settings.ai.fix.replaceKey',
    },
    {
      name: 'an unreachable provider',
      status: { source: 'openai' as const, connections: [key('openai', 'unreachable')] },
      problem: 'keyUnreachable',
      fix: 'settings.ai.fix.checkAgain',
    },
    {
      name: 'a withdrawn model',
      status: { source: 'openai' as const, connections: [key('openai', 'modelWithdrawn')] },
      problem: 'modelWithdrawn',
      fix: 'settings.ai.fix.changeModel',
    },
  ])('not working because of $name: one danger callout with the fix, which opens that key', async ({ status, problem, fix }) => {
    await show(cloud({ status: { ...on, ...status } }));
    expect(text()).toContain('settings.ai.state.notWorking');
    const callout = [...document.querySelectorAll('[data-slot="callout"]')].find((item) =>
      item.textContent?.includes('settings.ai.notWorking.title'),
    );
    expect(callout?.textContent).toContain(`settings.ai.problem.${problem}`);
    expect(document.querySelector('[data-key-form="openai"]')).toBeNull();
    await act(async () => button(fix, callout ?? document)?.click());
    expect(document.querySelector('[data-key-form="openai"]')).not.toBeNull();
  });

  it('not working because the docs failed to prepare: the fix prepares them again', async () => {
    await show(cloud({ status: { ...on, preparation: { state: 'failed', pages: 0, expectedPages: 128, at: null } } }));
    await act(async () => button('settings.ai.fix.prepare', check('prepared') ?? document)?.click());
    expect(mocks.prepare.mutate).toHaveBeenCalledTimes(1);
  });

  it('not working because the daily limit is used up: the fix goes to Usage', async () => {
    await show(cloud({ status: { ...on, usage: { answersToday: 12, spent: 200, limit: 200, resetsAt: '2026-11-12T00:00:00.000Z' } } }));
    expect(text()).toContain('settings.ai.problem.limitReached{"provider":"","limit":200}');
    expect(button('settings.ai.fix.seeUsage', check('usage') ?? document)?.getAttribute('href')).toBe(
      '/app/projects/$projectId/settings?section=usage',
    );
  });

  it('read-only for Editors and Viewers: one note, nothing they can change', async () => {
    mocks.access = 'notAdmin';
    await show(cloud({ status: { ...on, source: 'openai', connections: [key('openai')] } }));
    expect(text()).toContain('settings.permissions.body');
    expect(isDisabled(theSwitch())).toBe(true);
    expect(radios().every((radio) => isDisabled(radio))).toBe(true);
    expect(button('settings.ai.key.manage')).toBeUndefined();
  });
});

describe('AI answers controls', () => {
  it('turning on uses Nibleaf AI, says so, and starts preparing docs that are not prepared yet (D10)', async () => {
    mocks.select.mutate.mockImplementation((_body: unknown, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
    await show(cloud({ status: { preparation: { state: 'none', pages: 0, expectedPages: 128, at: null } } }));
    await act(async () => theSwitch()?.click());
    expect(mocks.select.mutate).toHaveBeenCalledWith({ providerId: 'instance', answersEnabled: true }, expect.any(Object));
    expect(mocks.toast).toHaveBeenCalledWith('settings.ai.toast.on');
    expect(mocks.prepare.mutate).toHaveBeenCalledTimes(1);
  });

  it('turning on prepared docs does not prepare them again', async () => {
    mocks.select.mutate.mockImplementation((_body: unknown, options?: { onSuccess?: () => void }) => options?.onSuccess?.());
    await show(cloud());
    await act(async () => theSwitch()?.click());
    expect(mocks.prepare.mutate).not.toHaveBeenCalled();
  });

  it('turning off keeps the selected source', async () => {
    await show(cloud({ status: { ...on, source: 'openrouter', connections: [key('openrouter')] } }));
    await act(async () => theSwitch()?.click());
    expect(mocks.select.mutate).toHaveBeenCalledWith({ providerId: 'openrouter', answersEnabled: false, expectedRevision: 3 }, expect.any(Object));
  });

  it.each([false, true])('choosing another source never changes whether answers are on (they are %s)', async (answersOn) => {
    await show(cloud({ status: { answersOn, connections: [key('openrouter')] } }));
    const openrouter = document.querySelector('[data-source="openrouter"] [role="radio"]') as HTMLElement;
    await act(async () => openrouter.click());
    expect(mocks.select.mutate).toHaveBeenCalledWith(
      { providerId: 'openrouter', answersEnabled: answersOn, expectedRevision: 3 },
      expect.any(Object),
    );
  });

  it('adds a key from its source card', async () => {
    await show(selfHosted());
    await act(async () => button('settings.ai.key.add', document.querySelector('[data-source="openrouter"]') ?? document)?.click());
    expect(document.querySelector('[data-key-form="openrouter"]')).not.toBeNull();
  });
});
