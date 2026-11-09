// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ detail: vi.fn(), refetch: vi.fn() }));
vi.mock('@/env', () => ({ env: {} }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@nibleaf/i18n/locale-state', () => ({ getLocale: () => 'en', subscribeLanguage: () => () => undefined }));
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
});
