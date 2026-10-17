// @vitest-environment jsdom
import type { SearchIndexDiagnosticsResult } from '@nibleaf/validators';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectSearchIndexDiagnostics } from './project-search';

const mocks = vi.hoisted(() => ({ diagnostics: vi.fn() }));
vi.mock('@/services/api', () => ({
  api: { app: { projects: { ':projectId': { settings: { search: { diagnostics: { $get: mocks.diagnostics } } } } } } },
}));

const diagnostics = (status: NonNullable<SearchIndexDiagnosticsResult['latestRun']>['status'] | null): SearchIndexDiagnosticsResult => ({
  availability: { configured: true, reason: status === 'READY' ? null : 'provider_unavailable' },
  health: status === 'READY' ? 'ready' : 'unavailable',
  runtime: 'hybrid',
  index: {
    logicalId: 'search',
    schemaVersion: 'v1',
    revisionId: 'revision',
    deploymentVersion: 1,
    embeddingModel: 'embedding-model',
    vectorSize: 1536,
  },
  corpus: {
    chunks: status === 'READY' ? 1 : null,
    pages: status === 'READY' ? 1 : null,
    languages: [],
    versions: [],
    distributionTruncated: { languages: false, versions: false },
  },
  latestRun: status
    ? {
        id: 'run',
        status,
        startedAt: null,
        completedAt: null,
        counts: {
          expected: 1,
          indexed: status === 'READY' ? 1 : 0,
          embedded: 0,
          reused: 0,
          unchanged: 0,
          metadataUpdated: 0,
          deleted: 0,
          stale: 0,
          failed: status === 'FAILED' ? 1 : 0,
        },
        errorCode: status === 'FAILED' ? 'provider_error' : null,
      }
    : null,
  samples: { items: [], nextCursor: null, hasMore: false },
  issues: { staleCount: 0, failedCount: 0, items: [] },
});
const response = (status: Parameters<typeof diagnostics>[0]) => Response.json({ data: diagnostics(status) });

let root: ReturnType<typeof createRoot>;
let client: QueryClient;
let container: HTMLDivElement;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  focusManager.setFocused(true);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  focusManager.setFocused(undefined);
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function mount() {
  function Probe() {
    const query = useProjectSearchIndexDiagnostics('qa-project');
    return createElement('output', null, query.data?.latestRun?.status ?? query.data?.health ?? 'loading');
  }
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Probe))));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('search index bootstrap recovery', () => {
  it.each([
    ['PENDING', 'READY'],
    ['RUNNING', 'FAILED'],
  ] as const)('polls an unavailable provider with a %s run until %s', async (active, terminal) => {
    mocks.diagnostics.mockResolvedValueOnce(response(active)).mockImplementation(async () => response(terminal));
    await mount();
    expect(container.textContent).toBe(active);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2100);
    });
    expect(mocks.diagnostics).toHaveBeenCalledTimes(2);
    expect(container.textContent).toBe(terminal);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(mocks.diagnostics).toHaveBeenCalledTimes(2);
  });

  it('does not continuously poll an unavailable provider without an active run', async () => {
    mocks.diagnostics.mockImplementation(async () => response(null));
    await mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(mocks.diagnostics).toHaveBeenCalledOnce();
  });
});
