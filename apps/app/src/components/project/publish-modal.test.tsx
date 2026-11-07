/** @vitest-environment jsdom */
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@/hooks/api/types';
import { PublishModal, reviewRows } from './publish-modal';

const { mutate, showError, preflight, refreshPreflight } = vi.hoisted(() => ({
  mutate: vi.fn(),
  showError: vi.fn(),
  preflight: { isFetching: false, issues: [] as Array<{ code: 'cycle'; message: string; sequence: string[]; rowIndexes: number[] }> },
  refreshPreflight: vi.fn(),
}));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('sonner', () => ({ toast: { error: showError } }));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, search, ...props }: { to: string; params: { projectId: string }; search: { section: string }; children: ReactNode }) => (
    <a {...props} href={`${to.replace('$projectId', encodeURIComponent(params.projectId))}?${new URLSearchParams(search)}`} />
  ),
}));
const pendingChange = {
  id: 'page-a',
  title: 'Getting started',
  path: 'getting-started',
  languageCode: 'en',
  kind: 'PAGE',
  status: 'modified',
  fields: ['content'],
  additions: 1,
  deletions: 0,
  lines: [] as Array<{ type: 'added' | 'removed' | 'unchanged'; text: string; oldLine: number | null; newLine: number | null }>,
  truncated: false,
};
vi.mock('@/hooks/api', () => ({
  friendlyErrorMessage: (_t: unknown, _error: unknown, key: string) => key,
  useDomains: () => ({ data: [] }),
  usePublish: () => ({ isPending: false, mutate }),
  usePendingChanges: () => ({
    // One edited page: publishing is only offered when there is something to publish.
    data: { changes: [pendingChange], redirectIssues: preflight.issues, hasBaseline: true },
    isPending: false,
    isFetching: preflight.isFetching,
    isError: false,
    refetch: refreshPreflight,
  }),
}));
vi.mock('@/lib/first-publish-activation', () => ({ readFirstPublishAttribution: () => null }));

const project = { id: 'project-a', name: 'Docs' } as Project;

describe('publish draft barrier', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    vi.clearAllMocks();
    preflight.isFetching = false;
    preflight.issues = [];
    refreshPreflight.mockResolvedValue({ data: { redirectIssues: [] }, isError: false });
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it('waits for the current draft before creating the deployment', async () => {
    let finishSaving!: () => void;
    const beforePublish = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSaving = resolve;
        }),
    );
    await act(async () =>
      root.render(<PublishModal beforePublish={beforePublish} onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />),
    );
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    if (!publish) throw new Error('Publish action was not rendered');
    await act(async () => publish.click());
    expect(beforePublish).toHaveBeenCalledOnce();
    expect(mutate).not.toHaveBeenCalled();
    expect(refreshPreflight).not.toHaveBeenCalled();
    await act(async () => finishSaving());
    expect(mutate).toHaveBeenCalledOnce();
    expect(refreshPreflight).toHaveBeenCalledOnce();
  });

  it('explains blocked redirects and links directly to their settings', async () => {
    preflight.issues = [{ code: 'cycle', message: 'RAW developer cycle trace', sequence: ['/old', '/new', '/old'], rowIndexes: [0, 1] }];
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    expect(document.body.textContent).toContain('publish.redirectIssue.cycle');
    expect(document.body.textContent).not.toContain('RAW developer');
    const link = document.querySelector<HTMLAnchorElement>('a[href="/app/projects/project-a/settings?section=appearance"]');
    expect(link?.textContent).toBe('publish.editRedirects');
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    expect(publish?.disabled).toBe(true);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('keeps publish available for retry without creating a deployment when saving fails', async () => {
    const beforePublish = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(undefined);
    await act(async () =>
      root.render(<PublishModal beforePublish={beforePublish} onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />),
    );
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    if (!publish) throw new Error('Publish action was not rendered');
    await act(async () => publish.click());
    expect(mutate).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalledWith('editor.saveError');
    expect(publish.disabled).toBe(false);
    await act(async () => publish.click());
    expect(mutate).toHaveBeenCalledOnce();
  });

  it('blocks a cached preflight while the latest saved changes are being fetched', async () => {
    preflight.isFetching = true;
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    if (!publish) throw new Error('Publish action was not rendered');
    expect(publish.disabled).toBe(true);
    expect(document.body.textContent).toContain('publish.checking');
    await act(async () => publish.click());
    expect(mutate).not.toHaveBeenCalled();
    preflight.isFetching = false;
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    expect(publish.disabled).toBe(false);
  });

  it('uses the post-save preflight result before starting a deployment', async () => {
    refreshPreflight.mockResolvedValue({ data: { redirectIssues: [{ message: 'Redirect loop' }] }, isError: false });
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    if (!publish) throw new Error('Publish action was not rendered');
    await act(async () => publish.click());
    expect(refreshPreflight).toHaveBeenCalledOnce();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('silently stops when unsaved configuration blocks publishing and allows a later retry', async () => {
    const beforePublish = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await act(async () =>
      root.render(<PublishModal beforePublish={beforePublish} onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />),
    );
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    if (!publish) throw new Error('Publish action was not rendered');
    await act(async () => publish.click());
    expect(refreshPreflight).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
    expect(publish.disabled).toBe(false);
    await act(async () => publish.click());
    expect(mutate).toHaveBeenCalledOnce();
  });

  it('does not publish after Cancel while the draft save is still pending', async () => {
    let finishSaving!: () => void;
    const beforePublish = () =>
      new Promise<void>((resolve) => {
        finishSaving = resolve;
      });
    const onOpenChange = vi.fn();
    await act(async () =>
      root.render(<PublishModal beforePublish={beforePublish} onOpenChange={onOpenChange} onPublished={vi.fn()} open project={project} />),
    );
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    const cancel = [...document.querySelectorAll('button')].find((button) => button.textContent === 'common.cancel');
    if (!publish || !cancel) throw new Error('Publish actions were not rendered');
    await act(async () => publish.click());
    await act(async () => cancel.click());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await act(async () => finishSaving());
    expect(refreshPreflight).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
  });

  it('does not publish after Cancel while the post-save preflight is still pending', async () => {
    let finishPreflight!: (result: { data: { redirectIssues: [] }; isError: false }) => void;
    refreshPreflight.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPreflight = resolve;
        }),
    );
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    const cancel = [...document.querySelectorAll('button')].find((button) => button.textContent === 'common.cancel');
    if (!publish || !cancel) throw new Error('Publish actions were not rendered');
    await act(async () => publish.click());
    expect(refreshPreflight).toHaveBeenCalledOnce();
    await act(async () => cancel.click());
    await act(async () => finishPreflight({ data: { redirectIssues: [] }, isError: false }));
    expect(mutate).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
  });

  it('invalidates a pending save when the publish UI unmounts', async () => {
    let finishSaving!: () => void;
    const beforePublish = () =>
      new Promise<void>((resolve) => {
        finishSaving = resolve;
      });
    await act(async () =>
      root.render(<PublishModal beforePublish={beforePublish} onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />),
    );
    const publish = [...document.querySelectorAll('button')].find((button) => button.textContent === 'publish.now');
    if (!publish) throw new Error('Publish action was not rendered');
    await act(async () => publish.click());
    await act(async () => root.unmount());
    await act(async () => finishSaving());
    expect(refreshPreflight).not.toHaveBeenCalled();
    expect(mutate).not.toHaveBeenCalled();
  });
});

const line = (type: 'added' | 'removed' | 'unchanged', text: string, oldLine: number | null, newLine: number | null) => ({
  type,
  text,
  oldLine,
  newLine,
});

describe('review changes', () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    pendingChange.lines = [];
    pendingChange.truncated = false;
  });

  const openReview = async () => {
    await act(async () => root.render(<PublishModal onOpenChange={vi.fn()} onPublished={vi.fn()} open project={project} />));
    const review = [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('publish.reviewDiff'));
    if (!review) throw new Error('Review action was not rendered');
    await act(async () => review.click());
  };

  it('shows the edited text line by line, each line in its own direction and named for screen readers', async () => {
    pendingChange.lines = [
      line('unchanged', 'Refunds take', 1, 1),
      line('removed', 'Refunds cost $10.', 2, null),
      line('added', 'تكلفة الاسترداد ١٥ دولارًا.', null, 2),
    ];
    await openReview();
    const texts = [...document.querySelectorAll('[dir="auto"]')].map((element) => element.textContent);
    expect(texts).toEqual(expect.arrayContaining(['Refunds cost $10.', 'تكلفة الاسترداد ١٥ دولارًا.']));
    expect(document.body.textContent).toContain('publish.removed');
    expect(document.body.textContent).toContain('publish.added');
    expect(document.body.innerHTML).not.toContain('#0b0b0b');
  });

  it('tells screen-reader users where unchanged lines were skipped', async () => {
    pendingChange.lines = [
      ...Array.from({ length: 10 }, (_, index) => line('unchanged', `line ${index + 1}`, index + 1, index + 1)),
      line('added', 'new line', null, 11),
    ];
    await openReview();
    const skipped = [...document.querySelectorAll('.sr-only')].filter((element) => element.textContent === 'publish.unchangedHidden');
    expect(skipped).toHaveLength(1);
    expect(skipped[0]?.closest('[aria-hidden]')).toBeNull();
  });

  it('says when the text did not change and when the list was shortened', async () => {
    pendingChange.lines = [line('unchanged', 'Same text', 1, 1)];
    pendingChange.truncated = true;
    await openReview();
    expect(document.body.textContent).toContain('publish.noLineDiff');
    expect(document.body.textContent).toContain('publish.diffTruncated');
  });
});

describe('reviewRows', () => {
  it('keeps a few lines around each change and collapses long unchanged stretches', () => {
    const lines = Array.from({ length: 20 }, (_, index) => line('unchanged', `line ${index + 1}`, index + 1, index + 1));
    lines[10] = line('added', 'new line', null, 11);
    const rows = reviewRows(lines, 2);
    expect(rows.map((row) => (row.kind === 'gap' ? '⋯' : row.line.text))).toEqual(['⋯', 'line 9', 'line 10', 'new line', 'line 12', 'line 13', '⋯']);
  });

  it('shows everything when the changes are close together', () => {
    const lines = [line('removed', 'a', 1, null), line('unchanged', 'b', 2, 1), line('added', 'c', null, 2)];
    expect(reviewRows(lines, 1).every((row) => row.kind === 'line')).toBe(true);
  });
});
