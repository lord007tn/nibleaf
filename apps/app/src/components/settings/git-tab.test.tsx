// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ confirm: vi.fn(), update: vi.fn() }));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ useConfirm: () => state.confirm }));
vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, vars?: Record<string, string>) => (vars ? `${key}:${Object.values(vars).join('|')}` : key),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('./git-workflow', () => ({ GitWorkflow: () => null }));
const idle = { mutate: vi.fn(), isPending: false };
vi.mock('@/hooks/api', () => ({
  useBranches: () => ({ data: [] }),
  useDeployments: () => ({ data: [] }),
  useImportFromGit: () => idle,
  useLanguages: () => ({ data: [] }),
  useRotateGitWebhookSecret: () => idle,
  useUpdateWorkspaceSettings: () => ({ mutate: state.update, isPending: false }),
  useWorkspaceSettings: () => ({
    isPending: false,
    isError: false,
    data: { git: { connected: true, provider: 'github', repo: 'team/docs', branch: 'main' } },
  }),
}));

import { GitTab } from './git-tab';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

it.each([false, true])('asks before disconnecting the public import, naming the repository (%s)', async (approved) => {
  state.update.mockClear();
  state.confirm.mockReset();
  state.confirm.mockResolvedValue(approved);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<GitTab />));
    // Public import is the advanced mode, folded away by default.
    const show = [...host.querySelectorAll('button')].find((item) => item.textContent?.includes('settings.git.publicImport.show'));
    await act(async () => show?.click());
    const disconnect = [...host.querySelectorAll('button')].find((item) => item.textContent?.startsWith('settings.git.disconnect'));
    if (!disconnect) throw new Error(`no disconnect button: ${[...host.querySelectorAll('button')].map((b) => b.textContent).join(' / ')}`);
    await act(async () => disconnect?.click());
    expect(state.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'settings.git.import.disconnectTitle:team/docs',
        description: 'settings.git.import.disconnectBody',
        destructive: true,
      }),
    );
    // Cancel sends nothing; confirming saves only the import connection as disconnected.
    expect(state.update).toHaveBeenCalledTimes(approved ? 1 : 0);
    if (approved) expect(state.update.mock.calls[0]?.[0]).toMatchObject({ git: expect.objectContaining({ connected: false, repo: 'team/docs' }) });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
