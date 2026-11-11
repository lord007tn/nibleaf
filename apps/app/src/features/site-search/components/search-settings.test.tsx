// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import { type AnchorHTMLAttributes, act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@/hooks/api';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { isolate } from '@/lib/bidi';
import { SearchSettings } from './search-settings';

type Diagnostics = { availability: { configured: boolean; reason: string | null }; health: string } & Record<string, unknown>;

const configuration = {
  maxResults: 12,
  filtersEnabled: true,
  versionFilterEnabled: true,
  aiAnswers: false,
  aiProvider: 'instance',
  aiConversationCapture: true,
  aiStarterQuestions: ['How do I start?'],
  hotkey: 'cmdk',
  placeholder: null as string | null,
};

const readyIndex = (overrides: Partial<Diagnostics> = {}): Diagnostics => ({
  availability: { configured: true, reason: null },
  health: 'ready',
  runtime: 'hybrid',
  index: { logicalId: 'l', schemaVersion: 'v3', revisionId: 'rev-1', deploymentVersion: 1, embeddingModel: 'embed-1', vectorSize: 3 },
  corpus: {
    chunks: 40,
    pages: 12,
    languages: [{ code: 'en', count: 40 }],
    versions: [{ slug: 'main', count: 40 }],
    distributionTruncated: { languages: false, versions: false },
  },
  latestRun: null,
  samples: { items: [], nextCursor: null, hasMore: false },
  issues: { staleCount: 0, failedCount: 0, items: [] },
  ...overrides,
});

const mocks = vi.hoisted(() => ({
  configuration: { data: undefined as unknown, isPending: false, isError: false, isFetching: false, refetch: vi.fn() },
  languages: [] as unknown[],
  updateConfiguration: vi.fn(),
  updateLanguage: vi.fn(),
  diagnostics: undefined as unknown,
  reindex: vi.fn(),
  ai: undefined as unknown,
  status: 'admin' as 'admin' | 'notAdmin' | 'pending',
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
  /** Use the app's real configuration and reindex mutations (and their shared error toasts) against a mocked API. */
  realMutations: false,
  patchConfiguration: vi.fn(),
  postReindex: vi.fn(),
}));

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key, translateFn: (key: string) => key }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError, success: mocks.toastSuccess } }));
vi.mock('@/services/api', () => ({
  api: {
    app: { projects: { ':projectId': { settings: { search: { $patch: mocks.patchConfiguration, reindex: { $post: mocks.postReindex } } } } } },
  },
}));
vi.mock('@/hooks/api', async () => {
  const search = await vi.importActual<typeof import('@/hooks/api/project-search')>('@/hooks/api/project-search');
  return {
    useProjectSearchConfiguration: () => mocks.configuration,
    // The real hooks always run (hooks never run conditionally); a test opts into their result.
    useUpdateProjectSearchConfiguration: (projectId: string) => {
      const real = search.useUpdateProjectSearchConfiguration(projectId);
      return mocks.realMutations ? real : { mutateAsync: mocks.updateConfiguration, isPending: false };
    },
    useLanguages: () => ({ data: mocks.languages, isPending: false }),
    useUpdateLanguage: () => ({ mutateAsync: mocks.updateLanguage, isPending: false }),
    useProjectSearchIndexDiagnostics: () => ({ data: mocks.diagnostics, isPending: !mocks.diagnostics, isError: false, isFetching: false }),
    useCreateProjectSearchReindex: (projectId: string) => {
      const real = search.useCreateProjectSearchReindex(projectId);
      return mocks.realMutations ? real : { isPending: false, mutate: mocks.reindex };
    },
  };
});
vi.mock('@/hooks/api/workspace-ai', () => ({ useWorkspaceAi: () => ({ data: mocks.ai }) }));
vi.mock('@/hooks/api/errors', () => ({ friendlyErrorMessage: () => 'Could not save' }));
vi.mock('@/hooks/use-project-admin-status', () => ({ useProjectAdminStatus: () => ({ status: mocks.status, edit: 'edit' }) }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, className }: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode }) => (
    <a className={className} href="/settings?section=smartAi">
      {children}
    </a>
  ),
  useBlocker: () => undefined,
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const project = { id: 'site-1' } as Project;
const aiReady = {
  infrastructureConfigured: true,
  selectedProvider: 'instance',
  instanceConfigured: true,
  instanceAnswersEnabled: true,
  providers: [],
};
let root: ReturnType<typeof createRoot>;
let container: HTMLDivElement;
let client: ReturnType<typeof createQueryClient>;

const render = () =>
  act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <SearchSettings project={project} />
      </QueryClientProvider>,
    ),
  );
/** Mounts again with the app's real mutations, which report their own failures through the shared toast. */
const remountWithRealMutations = async () => {
  await act(async () => root.unmount());
  mocks.realMutations = true;
  root = createRoot(container);
  await render();
};
/** Lets the lazily loaded error toast land, then a little longer, so a second toast would have shown too. */
const settleToasts = async () => {
  await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
  await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
};
/** What the API answers on failure: a technical message the person must never see. */
const failure = (status: number) => Response.json({ error: { message: `PrismaClientKnownRequestError (${status})` } }, { status });

beforeEach(async () => {
  mocks.configuration = {
    data: { configuration: { ...configuration }, constraints: { maxResults: { default: 12, min: 1, max: 50 } } },
    isPending: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  };
  mocks.languages = [];
  mocks.diagnostics = readyIndex();
  mocks.ai = aiReady;
  mocks.status = 'admin';
  mocks.realMutations = false;
  client = createQueryClient();
  mocks.updateConfiguration.mockResolvedValue({});
  mocks.updateLanguage.mockResolvedValue({});
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await render();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

const controlFor = (label: string) => {
  const labelEl = [...container.querySelectorAll('label')].find((el) => el.textContent === label);
  const control = labelEl ? document.getElementById(labelEl.htmlFor) : null;
  if (!control) throw new Error(`No control for ${label}`);
  return control;
};
const input = (label: string) => {
  const control = controlFor(label);
  if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement)) throw new Error(`No text control for ${label}`);
  return control;
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
const region = () => container.querySelector('[data-slot="save-region"]');
const save = () => act(async () => [...(region()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes('common.save'))?.click());
const errorOf = (el: HTMLElement) =>
  (el.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id))
    .find((node) => node?.dataset.slot === 'settings-row-error')?.textContent;
const reindexButton = () =>
  [...container.querySelectorAll('button')].find((b) => b.textContent?.startsWith('settings.search.diagnostics.reindex')) as HTMLButtonElement;

describe('SearchSettings', () => {
  it('renders one page with no errors and no save bar while untouched', () => {
    expect(container.querySelector('h1')?.textContent).toBe('settings.search.title');
    expect([...container.querySelectorAll('h2')].map((h) => h.textContent)).toEqual([
      'settings.search.box.title',
      'dashboard.ai.title',
      'settings.search.diagnostics.title',
    ]);
    expect(container.querySelector('[aria-invalid="true"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(region()).toBeNull();
  });

  it('explains an out-of-range result limit on the field instead of clamping it, and sends nothing', async () => {
    const maxResults = input('settings.search.maxResults.label');
    await type(maxResults, '80');
    expect(maxResults.getAttribute('aria-invalid')).toBeNull();
    await blur(maxResults);
    expect(errorOf(maxResults)).toBe('settings.search.maxResults.error');
    await save();
    expect(mocks.updateConfiguration).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(maxResults.value).toBe('80');
    await type(maxResults, '20');
    expect(maxResults.getAttribute('aria-invalid')).toBeNull();
    await save();
    expect(mocks.updateConfiguration).toHaveBeenCalledWith({ maxResults: 20 });
  });

  it('shows invalid suggested questions and support links on their fields, never as a toast', async () => {
    const starters = input('dashboard.ai.starters');
    const support = input('dashboard.ai.supportUrl');
    await type(starters, 'Hi');
    await type(support, 'help.example.com');
    // Nothing shows while typing in a fresh field.
    expect(starters.getAttribute('aria-invalid')).toBeNull();
    expect(support.getAttribute('aria-invalid')).toBeNull();
    await save();
    expect(errorOf(starters)).toBe('dashboard.ai.startersError');
    expect(errorOf(support)).toBe('dashboard.ai.supportUrlError');
    expect(document.activeElement).toBe(starters);
    expect(mocks.updateConfiguration).not.toHaveBeenCalled();
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('keeps every control in one form: a switch makes it dirty and saves only what changed', async () => {
    const capture = controlFor('dashboard.ai.capture');
    await act(async () => capture.click());
    expect(region()).not.toBeNull();
    await type(input('settings.search.placeholder.label'), '  Find a guide ');
    await save();
    expect(mocks.updateConfiguration).toHaveBeenCalledWith({ placeholder: 'Find a guide', aiConversationCapture: false });
    expect(mocks.updateLanguage).not.toHaveBeenCalled();
    expect(region()).toBeNull();
  });

  it('discards every change, the switches included', async () => {
    const capture = controlFor('dashboard.ai.capture');
    await act(async () => capture.click());
    await type(input('settings.search.placeholder.label'), 'Find');
    await act(async () => [...(region()?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.includes('forms.discard'))?.click());
    expect(region()).toBeNull();
    const row = capture.closest('[data-slot="settings-row"]');
    expect(row?.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true');
    expect(input('settings.search.placeholder.label').value).toBe('');
  });

  it('leaves a failed configuration save to its mutation, so the form adds no toast, and stays dirty', async () => {
    mocks.updateConfiguration.mockRejectedValueOnce(new Error('PrismaClientKnownRequestError'));
    await type(input('settings.search.placeholder.label'), 'Find');
    await save();
    expect(mocks.toastError).not.toHaveBeenCalled();
    expect(region()).not.toBeNull();
  });

  it('reports a failed configuration save exactly once, in plain words, through the real mutation', async () => {
    await remountWithRealMutations();
    mocks.patchConfiguration.mockResolvedValueOnce(failure(500));
    await type(input('settings.search.placeholder.label'), 'Find');
    await save();
    await settleToasts();
    expect(mocks.patchConfiguration).toHaveBeenCalledOnce();
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('Could not save');
    expect(region()).not.toBeNull();
  });

  it('edits each language placeholder in the same form; an emptied one clears the override', async () => {
    await act(async () => root.unmount());
    mocks.configuration = {
      ...mocks.configuration,
      data: { configuration: { ...configuration, placeholder: 'Search the guides' }, constraints: { maxResults: { default: 12, min: 1, max: 50 } } },
    };
    mocks.languages = [
      { id: 'en', code: 'en', label: 'English', isDefault: true, position: 0, direction: 'LTR' },
      { id: 'ar', code: 'ar', label: 'العربية', isDefault: false, position: 1, direction: 'RTL', config: { search: { placeholder: 'ابحث' } } },
      { id: 'fr', code: 'fr', label: 'Français', isDefault: false, position: 2, direction: 'LTR', config: null },
    ];
    root = createRoot(container);
    await render();
    const field = (code: string) => [...container.querySelectorAll('input')].find((el) => el.lang === code) as HTMLInputElement;
    expect(field('ar').dir).toBe('rtl');
    expect(field('ar').value).toBe('ابحث');
    // Empty falls back to the site's placeholder, so that is what it shows.
    expect(field('fr').placeholder).toBe(isolate('Search the guides'));
    await type(field('fr'), 'Chercher');
    await type(field('ar'), '');
    await save();
    expect(mocks.updateConfiguration).not.toHaveBeenCalled();
    expect(mocks.updateLanguage).toHaveBeenCalledWith({ id: 'ar', body: { config: { search: null } } });
    expect(mocks.updateLanguage).toHaveBeenCalledWith({ id: 'fr', body: { config: { search: { placeholder: 'Chercher' } } } });
  });

  it('words a failed language save once, in plain language', async () => {
    await act(async () => root.unmount());
    mocks.languages = [
      { id: 'en', code: 'en', label: 'English', isDefault: true, position: 0, direction: 'LTR' },
      { id: 'fr', code: 'fr', label: 'Français', isDefault: false, position: 1, direction: 'LTR' },
    ];
    mocks.updateLanguage.mockRejectedValueOnce(new Error('Could not update the language.'));
    root = createRoot(container);
    await render();
    await type([...container.querySelectorAll('input')].find((el) => el.lang === 'fr') as HTMLInputElement, 'Chercher');
    await save();
    expect(mocks.toastError).toHaveBeenCalledOnce();
    expect(mocks.toastError).toHaveBeenCalledWith('Could not save');
    expect(region()).not.toBeNull();
  });

  it('says why grounded answers cannot be turned on, with the way to fix it', async () => {
    await act(async () => root.unmount());
    mocks.ai = { ...aiReady, instanceAnswersEnabled: false };
    root = createRoot(container);
    await render();
    const answers = controlFor('settings.search.aiAnswers.label');
    const toggle = answers.closest('[data-slot="settings-row"]')?.querySelector('[role="switch"]');
    expect(toggle?.hasAttribute('data-disabled')).toBe(true);
    const reason = container.querySelector('[data-slot="settings-row-reason"]');
    expect(reason?.textContent).toContain('settings.search.aiAnswers.needsConnection');
    expect(reason?.querySelector('a')?.textContent).toBe('settings.search.aiAnswers.openSmartAi');
  });

  it('shows the page read-only to non-Admins, with one note saying why', async () => {
    await act(async () => root.unmount());
    mocks.status = 'notAdmin';
    root = createRoot(container);
    await render();
    expect(container.textContent).toContain('settings.permissions.body');
    expect(input('settings.search.placeholder.label').disabled).toBe(true);
    expect(input('dashboard.ai.starters').disabled).toBe(true);
    expect(reindexButton().disabled).toBe(true);
  });

  it('offers a retry when the configuration fails to load, and keeps the index section', async () => {
    await act(async () => root.unmount());
    mocks.configuration = { ...mocks.configuration, data: undefined, isError: true };
    root = createRoot(container);
    await render();
    expect(container.textContent).toContain('settings.search.configuration.error');
    expect(container.querySelector('[data-testid="search-index-diagnostics"]')).not.toBeNull();
  });
});

describe('index health', () => {
  const rerender = async (diagnostics: Diagnostics) => {
    mocks.diagnostics = diagnostics;
    await render();
  };

  it.each([
    ['provider_unavailable', null],
    ['not_configured', 'settings.search.diagnostics.notConfigured'],
    ['not_published', 'settings.search.diagnostics.notPublished'],
  ])('keeps reindex recovery %s truthful', async (reason, disabledReason) => {
    await rerender(readyIndex({ availability: { configured: reason !== 'not_configured', reason }, health: 'unavailable' }));
    const button = reindexButton();
    if (disabledReason) {
      expect(button.getAttribute('aria-disabled')).toBe('true');
      const described = (button.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);
      expect(described).toContain(disabledReason);
    } else {
      expect(button.disabled).toBe(false);
      await act(async () => button.click());
      expect(mocks.reindex).toHaveBeenCalledOnce();
    }
  });

  it('refuses a second run while indexing, and says so', async () => {
    await rerender(readyIndex({ health: 'indexing' }));
    const described = (reindexButton().getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(described).toContain('settings.search.diagnostics.reindexActive');
  });

  it('reports a failed reindex exactly once, in plain words, through the real mutation', async () => {
    await remountWithRealMutations();
    mocks.postReindex.mockResolvedValueOnce(failure(409));
    await act(async () => reindexButton().click());
    await settleToasts();
    expect(mocks.postReindex).toHaveBeenCalledOnce();
    expect(mocks.toastError).toHaveBeenCalledExactlyOnceWith('Could not save');
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
  });

  it('shows the health as a status badge and the counts as rows', async () => {
    const section = container.querySelector('[data-testid="search-index-diagnostics"]');
    expect(section?.querySelector('[data-slot="settings-section"] h3, h3')?.textContent).toBe('settings.search.diagnostics.indexTitle');
    expect(controlFor('settings.search.diagnostics.healthLabel').textContent).toBe('settings.search.diagnostics.health.ready');
    expect(controlFor('settings.search.diagnostics.pages').textContent).toBe('12');
    expect(section?.textContent).toContain('settings.search.diagnostics.noSamples');
  });

  it('explains an index that cannot be inspected', async () => {
    await rerender(readyIndex({ availability: { configured: true, reason: 'not_published' }, health: 'unavailable' }));
    const section = container.querySelector('[data-testid="search-index-diagnostics"]');
    expect(section?.textContent).toContain('settings.search.diagnostics.unavailableTitle');
    expect(section?.textContent).toContain('settings.search.diagnostics.notPublished');
  });

  it('lists issue samples with their code', async () => {
    await rerender(
      readyIndex({
        health: 'failed',
        issues: {
          staleCount: 0,
          failedCount: 1,
          items: [{ pageId: 'page-1', ordinal: 2, language: 'en', versionSlug: 'main', status: 'failed', errorCode: 'EMBED_TIMEOUT' }],
        },
      }),
    );
    const section = container.querySelector('[data-testid="search-index-diagnostics"]');
    expect(section?.textContent).toContain('settings.search.diagnostics.issuesTitle');
    expect(section?.querySelector('ul')?.textContent).toContain('page-1');
    expect(section?.querySelector('ul')?.textContent).toContain('settings.search.diagnostics.issueCode');
  });
});
