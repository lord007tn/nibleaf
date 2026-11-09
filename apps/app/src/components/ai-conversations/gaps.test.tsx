// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), navigate: vi.fn(), refetch: vi.fn(), languagesPending: false, languagesError: false }));
vi.mock('@/env', () => ({ env: {} }));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: null }) }));
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => (params ? `${key} ${JSON.stringify(params)}` : key),
  useLocale: () => ({ locale: 'en' }),
}));
vi.mock('@nibleaf/i18n/locale-state', () => ({ getLocale: () => 'en', subscribeLanguage: () => () => undefined }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/api', () => ({
  useLanguages: () => ({
    isSuccess: !mocks.languagesPending && !mocks.languagesError,
    isPending: mocks.languagesPending,
    isError: mocks.languagesError,
    isFetching: false,
    refetch: mocks.refetch,
    data: mocks.languagesPending
      ? undefined
      : [
          { id: 'lang-en', code: 'en', label: 'English', isDefault: true },
          { id: 'lang-ar', code: 'ar', label: 'العربية', isDefault: false },
        ],
  }),
  useProjectMembers: () => ({ data: undefined }),
}));
vi.mock('@/hooks/api/mutations', () => ({
  useCreatePage: () => ({ mutate: mocks.mutate, isPending: false }),
  useUpdateProjectConfig: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ContentGaps } from './gaps';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const gap = (question: string, language: string) => ({
  question,
  language,
  askedCount: 4,
  noAnswerCount: 3,
  downCount: 1,
  lastAskedAt: '2026-11-02T10:00:00.000Z',
  sampleConversationId: `chat-${language}`,
  reason: 'no_answer' as const,
});

describe('content gaps', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
    mocks.languagesPending = false;
    mocks.languagesError = false;
  });

  it("writes a draft titled with the question, in the question's language, and opens it", async () => {
    await act(async () => root.render(<ContentGaps items={[gap('كيف أبدأ؟', 'ar')]} onOpen={vi.fn()} projectId="site-1" />));
    const write = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('dashboard.ai.write'));
    await act(async () => write?.click());
    expect(mocks.mutate).toHaveBeenCalledWith({ title: 'كيف أبدأ؟', languageId: 'lang-ar' }, expect.anything());

    const options = mocks.mutate.mock.calls[0]?.[1] as { onSuccess: (page: { id: string }) => void } | undefined;
    options?.onSuccess({ id: 'draft-1' });
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: '/app/projects/$projectId/editor',
      params: { projectId: 'site-1' },
      search: { page: 'draft-1' },
    });
  });

  it('names the language instead of showing its code', async () => {
    await act(async () => root.render(<ContentGaps items={[gap('How do I start?', 'ar')]} onOpen={vi.fn()} projectId="site-1" />));
    expect(container.textContent).toContain('العربية');
  });

  it('falls back to the default language for a code the site no longer has', async () => {
    await act(async () => root.render(<ContentGaps items={[gap('Wie starte ich?', 'de')]} onOpen={vi.fn()} projectId="site-1" />));
    const write = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('dashboard.ai.write'));
    await act(async () => write?.click());
    expect(mocks.mutate).toHaveBeenCalledWith({ title: 'Wie starte ich?' }, expect.anything());
  });

  it('waits for the site languages before writing, instead of silently creating a default-language draft', async () => {
    mocks.languagesPending = true;
    await act(async () => root.render(<ContentGaps items={[gap('كيف أبدأ؟', 'ar')]} onOpen={vi.fn()} projectId="site-1" />));
    const write = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('dashboard.ai.write'));
    expect(write?.disabled).toBe(true);
    await act(async () => write?.click());
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('writes the Arabic draft once the languages arrive after an early hover', async () => {
    mocks.languagesPending = true;
    const ui = <ContentGaps items={[gap('كيف أبدأ؟', 'ar')]} onOpen={vi.fn()} projectId="site-1" />;
    await act(async () => root.render(ui));
    mocks.languagesPending = false;
    await act(async () => root.render(<ContentGaps items={[gap('كيف أبدأ؟', 'ar')]} onOpen={vi.fn()} projectId="site-1" />));
    const write = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('dashboard.ai.write'));
    expect(write?.disabled).toBe(false);
    await act(async () => write?.click());
    expect(mocks.mutate).toHaveBeenCalledWith({ title: 'كيف أبدأ؟', languageId: 'lang-ar' }, expect.anything());
  });

  it('says the languages could not be loaded and offers a retry instead of a silent disabled button', async () => {
    mocks.languagesError = true;
    await act(async () => root.render(<ContentGaps items={[gap('كيف أبدأ؟', 'ar')]} onOpen={vi.fn()} projectId="site-1" />));
    expect(container.textContent).toContain('analytics.search.write.languagesError');
    const retry = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('error.tryAgain'));
    await act(async () => retry?.click());
    expect(mocks.refetch).toHaveBeenCalledOnce();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
