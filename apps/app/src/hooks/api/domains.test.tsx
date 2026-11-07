// @vitest-environment jsdom

import { QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { ApiResponseError } from './client-helpers';
import { demotedByError, domainErrorMessage, domainStage, pickLiveDomain } from './domain-state';
import { useDeleteDomain, useSetPrimaryDomain, useVerifyDomain } from './domains';

const mocks = vi.hoisted(() => ({ remove: vi.fn(), primary: vi.fn(), verify: vi.fn(), toastError: vi.fn() }));

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));
vi.mock('@/services/api', () => ({
  api: {
    app: {
      projects: {
        ':projectId': {
          domains: { ':id': { $delete: mocks.remove, primary: { $post: mocks.primary }, verify: { $post: mocks.verify } } },
        },
      },
    },
  },
}));

const t = (key: string) => key;
const failure = (status: number, code: string) =>
  new Response(JSON.stringify({ error: { code, message: 'Technical English from the server.' } }), { status });

describe('domain status helpers', () => {
  it('names each setup step from the stored DNS and HTTPS states', () => {
    expect(domainStage({ dnsStatus: 'PENDING', sslStatus: 'PENDING' })).toBe('waiting');
    expect(domainStage({ dnsStatus: 'ERROR', sslStatus: 'ACTIVE' })).toBe('dnsProblem');
    expect(domainStage({ dnsStatus: 'VERIFIED', sslStatus: 'PROVISIONING' })).toBe('securing');
    expect(domainStage({ dnsStatus: 'VERIFIED', sslStatus: 'PENDING' })).toBe('securing');
    expect(domainStage({ dnsStatus: 'VERIFIED', sslStatus: 'ERROR' })).toBe('httpsProblem');
    expect(domainStage({ dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE' })).toBe('live');
  });

  it('sends readers only to a verified domain with working DNS and HTTPS, primary first', () => {
    const live = { verified: true, dnsStatus: 'VERIFIED', sslStatus: 'ACTIVE' } as const;
    expect(
      pickLiveDomain([
        { ...live, isPrimary: false, domain: 'a' },
        { ...live, isPrimary: true, domain: 'b' },
      ])?.domain,
    ).toBe('b');
    // Ownership passed, routing or HTTPS did not (the self-host path sets `verified` first).
    expect(pickLiveDomain([{ ...live, dnsStatus: 'ERROR', isPrimary: true }])).toBeUndefined();
    expect(pickLiveDomain([{ ...live, sslStatus: 'PROVISIONING', isPrimary: false }])).toBeUndefined();
  });

  it('words server failures from their code, never the raw message', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(domainErrorMessage(t, new ApiResponseError('x', 409, 'domain:already_added'), 'settings.domain.toast.addError')).toBe(
      'settings.domain.error.alreadyAdded',
    );
    expect(domainErrorMessage(t, new ApiResponseError('x', 422, 'validation:failed'), 'settings.domain.toast.addError')).toBe(
      'settings.domain.error.invalid',
    );
    expect(domainErrorMessage(t, new ApiResponseError('x', 500, 'http:internal'), 'settings.domain.toast.addError')).toBe(
      'settings.domain.toast.addError',
    );
    expect(domainErrorMessage(t, new TypeError('fetch failed'), 'settings.domain.toast.addError')).toBe('error.network');
    expect(domainErrorMessage(t, new ApiResponseError('x', 503, 'domain:check_inconclusive'), 'settings.domain.toast.verifyError')).toBe(
      'settings.domain.error.checkInconclusive',
    );
  });
});

describe('domain actions report their own failures', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  const run = async (useAction: (projectId: string) => { mutateAsync: (id: string) => Promise<unknown> }) => {
    const queryClient = createQueryClient();
    let action: { mutateAsync: (id: string) => Promise<unknown> } | undefined;
    const Probe = () => {
      action = useAction('site-1');
      return null;
    };
    await act(async () => root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(Probe))));
    await act(async () => {
      await action?.mutateAsync('domain-1').catch(() => undefined);
    });
    // The shared mutation cache loads the toast library lazily.
    await vi.waitFor(() => expect(mocks.toastError).toHaveBeenCalled());
  };

  it('removing: says the domain service could not be reached', async () => {
    mocks.remove.mockResolvedValue(failure(502, 'domain:provider_failed'));
    await run(useDeleteDomain);
    expect(mocks.toastError).toHaveBeenCalledWith('settings.domain.error.providerFailed');
  });

  it('removing: falls back to a plain "could not remove" message', async () => {
    mocks.remove.mockResolvedValue(failure(500, 'http:internal'));
    await run(useDeleteDomain);
    expect(mocks.toastError).toHaveBeenCalledWith('settings.domain.toast.removeError');
  });

  it('making primary: explains that the domain is not connected yet', async () => {
    mocks.primary.mockResolvedValue(failure(409, 'domain:not_ready'));
    await run(useSetPrimaryDomain);
    expect(mocks.toastError).toHaveBeenCalledWith('settings.domain.error.notReady');
  });

  it('checking: keeps the error details, so the card can say the main address was dropped', async () => {
    mocks.verify.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'domain:not_pointed', message: 'x', details: { stage: 'routing', demoted: true } } }), {
        status: 422,
      }),
    );
    const queryClient = createQueryClient();
    let action: ReturnType<typeof useVerifyDomain> | undefined;
    const Probe = () => {
      action = useVerifyDomain('site-1');
      return null;
    };
    await act(async () => root.render(createElement(QueryClientProvider, { client: queryClient }, createElement(Probe))));
    let caught: unknown;
    await act(async () => {
      caught = await action?.mutateAsync('domain-1').catch((error: unknown) => error);
    });
    expect(demotedByError(caught)).toBe(true);
  });

  it('checking: says which record is missing', async () => {
    mocks.verify.mockResolvedValue(failure(422, 'domain:not_pointed'));
    await run(useVerifyDomain);
    expect(mocks.toastError).toHaveBeenCalledWith('settings.domain.error.notPointed');
  });
});
