// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ detail: vi.fn(), refetch: vi.fn() }));
vi.mock('@/env', () => ({ env: {} }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
// The auth surfaces translate through AUTH_MESSAGES (MKT-001); give them the
// same translator and locale as the @nibleaf/i18n/react mock above.
vi.mock('@/lib/auth-messages', async () => {
  const react = (await import('@nibleaf/i18n/react')) as unknown as {
    useT?: () => (key: string, variables?: Record<string, string | number>) => string;
    useLocale?: () => Record<string, unknown>;
  };
  // Plain names: the mocks are read per render, not called as hooks here. A
  // mock without one of them throws on access, hence the `in` checks.
  const readT = 'useT' in react ? react.useT : undefined;
  const readLocale = 'useLocale' in react ? react.useLocale : undefined;
  const authLocale = (): Record<string, unknown> => ({ locale: 'en', setLocale: () => undefined, ...(readLocale ? readLocale() : { t: readT?.() }) });
  return { useAuthLocale: authLocale, useAuthT: () => (readT ? readT() : authLocale().t) };
});

vi.mock('@nibleaf/i18n/locale-state', () => ({ getLocale: () => 'en', renderedLocale: () => 'en', subscribeLanguage: () => () => undefined }));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/hooks/api', () => ({ useProjectMembers: () => ({ data: undefined, isError: false }) }));
vi.mock('@/hooks/api/ai-conversations', () => ({
  useAiConversation: mocks.detail,
  useDeleteAiConversation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/services/auth-client', () => ({ useSession: () => ({ data: null }) }));

import { ApiResponseError } from '@/hooks/api/client-helpers';
import { ConversationDetail } from './detail';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('conversation detail errors', () => {
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
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  const renderWith = async (error: unknown) => {
    mocks.detail.mockReturnValue({ isPending: false, isError: true, error, isFetching: false, refetch: mocks.refetch, data: undefined });
    await act(async () => root.render(<ConversationDetail conversation="chat-1" onClose={vi.fn()} projectId="site-1" />));
  };

  it('says a deleted or expired conversation is gone, with nothing to retry', async () => {
    await renderWith(new ApiResponseError('Not found', 404));
    expect(document.body.textContent).toContain('dashboard.ai.missing');
    expect(document.body.textContent).not.toContain('error.tryAgain');
  });

  it('offers a retry for a dropped connection or a server error instead of calling it missing', async () => {
    await renderWith(new ApiResponseError('Unavailable', 503));
    expect(document.body.textContent).not.toContain('dashboard.ai.missing');
    const retry = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('error.tryAgain'));
    await act(async () => retry?.click());
    expect(mocks.refetch).toHaveBeenCalledOnce();
  });

  it('says the session ended and links to sign-in on a 401, instead of a load failure', async () => {
    await renderWith(new ApiResponseError('Unauthorized', 401));
    expect(document.body.textContent).toContain('dashboard.ai.sessionExpired');
    expect(document.body.textContent).not.toContain('error.tryAgain');
    const link = [...document.querySelectorAll<HTMLAnchorElement>('a')].find((a) => a.textContent?.includes('dashboard.ai.signInAgain'));
    expect(link?.getAttribute('href')).toMatch(/^\/sign-in\?next=/);
  });
});
