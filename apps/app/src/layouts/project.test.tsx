// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ edit: 'pending' as 'pending' | 'edit' | 'viewOnly' | 'unknown' }));

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
vi.mock('@tanstack/react-router', () => ({ Link: () => null, useRouterState: () => '/' }));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));
vi.mock('@/components/app/command-palette', () => ({ useOpenCommandPalette: () => vi.fn() }));
vi.mock('@/components/app/notifications-popover', () => ({ NotificationsPopover: () => null }));
vi.mock('@/components/app/project-sidebar', () => ({ ProjectSidebar: () => null }));
vi.mock('@/components/project/deploy-pipeline', () => ({ DeployPipeline: () => null }));
// The dialog itself has its own tests; here only whether it is open matters.
vi.mock('@/components/project/publish-modal', () => ({
  PublishModal: ({ open }: { open: boolean }) => (open ? <div data-testid="publish-dialog" /> : null),
}));
vi.mock('@/hooks/api', () => ({
  useDeployments: () => ({ data: [] }),
  usePendingChanges: () => ({ data: { changes: [] } }),
  useProject: () => ({ data: undefined }),
}));
vi.mock('@/hooks/use-project-admin-status', () => ({ useProjectAdminStatus: () => ({ edit: state.edit }) }));

import { PublishControl } from './project';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const project = { id: 'site-1' } as never;

describe('PublishControl while the role is loading, failed or a Viewer', () => {
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
  });

  const render = (initialPublishOpen = false) =>
    act(async () => root.render(<PublishControl initialPublishOpen={initialPublishOpen} project={project} />));
  const publish = () => container.querySelector<HTMLButtonElement>('button[aria-label="project.publish"]');
  const dialogOpen = () => container.querySelector('[data-testid="publish-dialog"]') !== null;

  it.each([
    ['pending', 'access.checking.publish'],
    ['unknown', 'access.unknown.title'],
  ] as const)('keeps Publish disabled while the role is %s, and says why', async (edit, reason) => {
    state.edit = edit;
    await render();
    expect(publish()?.disabled).toBe(true);
    expect(publish()?.title).toBe(reason);
  });

  it('opens a ?publish=true request only once edit access is known', async () => {
    state.edit = 'pending';
    await render(true);
    expect(dialogOpen()).toBe(false);
    state.edit = 'edit';
    await render(true);
    expect(dialogOpen()).toBe(true);
    expect(publish()?.disabled).toBe(false);
  });

  it('drops a Viewer’s ?publish=true request, so a later promotion never pops the dialog open', async () => {
    state.edit = 'pending';
    await render(true);
    state.edit = 'viewOnly';
    await render(true);
    expect(dialogOpen()).toBe(false);
    expect(publish()?.title).toBe('access.viewOnly.publish');
    state.edit = 'edit';
    await render(true);
    expect(dialogOpen()).toBe(false);
  });
});
