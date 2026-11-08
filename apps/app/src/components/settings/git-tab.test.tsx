// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  confirm: vi.fn(),
  update: vi.fn(),
  legacy: null as Record<string, unknown> | null,
  workflow: null as Record<string, unknown> | null,
  workflowProps: [] as Array<{ prefill?: unknown; onConnected?: () => void }>,
}));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => state.confirm }));
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, vars?: Record<string, string>) => (vars ? `${key}:${Object.values(vars).join('|')}` : key),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The per-site connection has its own tests; here only what the tab hands it matters.
vi.mock('./git-workflow', () => ({
  GitWorkflow: (props: { prefill?: unknown; onConnected?: () => void }) => {
    state.workflowProps.push(props);
    return <div data-testid="git-workflow" />;
  },
}));
const idle = { mutate: vi.fn(), isPending: false };
vi.mock('@/hooks/api', () => ({
  useBranches: () => ({ data: [] }),
  useDeployments: () => ({ data: [] }),
  useGitWorkflow: () => ({ data: state.workflow, isPending: false }),
  useImportFromGit: () => idle,
  useLanguages: () => ({ data: [] }),
  useRotateGitWebhookSecret: () => idle,
  useUpdateWorkspaceSettings: () => ({ mutate: state.update, isPending: false }),
  useWorkspaceSettings: () => ({ isPending: false, isError: false, data: { git: state.legacy } }),
}));

import { GitTab } from './git-tab';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
Element.prototype.scrollIntoView = vi.fn();

describe('one Git surface per site', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    state.update.mockClear();
    state.confirm.mockReset();
    state.workflowProps = [];
    state.workflow = null;
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  const render = () => act(async () => root.render(<GitTab projectId="site-1" />));
  const button = (label: string) => [...host.querySelectorAll('button')].find((item) => item.textContent?.startsWith(label));
  const legacy = () => host.querySelector('[data-testid="git-legacy"]');

  it('shows only the per-site connection to a site without legacy settings', async () => {
    state.legacy = null;
    await render();
    expect(host.querySelector('[data-testid="git-workflow"]')).not.toBeNull();
    expect(legacy()).toBeNull();
    // No second way to connect a repository.
    expect(host.querySelector('#git-repo')).toBeNull();
    expect(host.textContent).not.toContain('settings.git.connect');
  });

  it('switches a GitHub legacy import over in one click, then turns the legacy import off', async () => {
    state.legacy = { connected: true, provider: 'github', repo: 'https://github.com/team/docs.git', branch: 'main', path: 'content' };
    await render();
    expect(legacy()?.textContent).toContain('settings.git.legacy.title');
    expect(legacy()?.textContent).toContain('settings.git.legacy.switchable:https://github.com/team/docs.git');

    await act(async () => button('settings.git.legacy.switch')?.click());
    expect(state.workflowProps.at(-1)?.prefill).toMatchObject({ repository: 'team/docs', baseBranch: 'main', contentPath: 'content' });
    expect(state.update).not.toHaveBeenCalled();

    // Saving the new connection switches the legacy import off, keeping its details.
    await act(async () => state.workflowProps.at(-1)?.onConnected?.());
    expect(state.update).toHaveBeenCalledOnce();
    expect(state.update.mock.calls[0]?.[0]).toMatchObject({
      git: expect.objectContaining({ connected: false, repo: 'https://github.com/team/docs.git' }),
    });
  });

  it('keeps a GitLab legacy import running, read-only about switching, with its own stop', async () => {
    state.legacy = { connected: true, provider: 'gitlab', repo: 'group/docs', branch: 'main', path: 'docs' };
    state.confirm.mockResolvedValue(false);
    await render();
    expect(legacy()?.textContent).toContain('settings.git.legacy.readOnly:group/docs');
    expect(button('settings.git.legacy.switch')).toBeUndefined();
    await act(async () => button('settings.git.disconnect')?.click());
    expect(state.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'settings.git.import.disconnectTitle:group/docs',
        description: 'settings.git.import.disconnectBody',
        destructive: true,
      }),
    );
    // Cancel sends nothing.
    expect(state.update).not.toHaveBeenCalled();
  });

  it('marks legacy settings as unused once the new connection exists, and removes them after confirming', async () => {
    state.legacy = { connected: true, provider: 'github', repo: 'team/docs', branch: 'main', path: '' };
    state.workflow = { repository: 'team/docs', operations: [] };
    state.confirm.mockResolvedValue(true);
    await render();
    expect(legacy()?.textContent).toContain('settings.git.legacy.replaced:team/docs');
    // Its import and webhook controls are gone: the new connection runs Git now.
    expect(button('settings.git.legacy.switch')).toBeUndefined();
    expect(host.querySelector('#git-repo')).toBeNull();
    await act(async () => button('settings.git.legacy.remove')?.click());
    expect(state.update.mock.calls[0]?.[0]).toMatchObject({ git: expect.objectContaining({ connected: false }) });
  });
});
