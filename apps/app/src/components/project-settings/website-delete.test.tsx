// @vitest-environment jsdom

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ navigate: vi.fn(), prompt: vi.fn(), mutate: vi.fn() }));
vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string, vars?: Record<string, string>) => (vars?.org ? `${key}:${vars.org}` : key) }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@nibleaf/design-system/components/ui/confirm', () => ({ usePrompt: () => mocks.prompt }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/api', () => ({ useDeleteProject: () => ({ isPending: false, mutate: mocks.mutate }) }));

import { DangerSection } from './danger-section';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;
const project = { id: 'site-1', name: 'API reference', organizationId: 'org-1' } as never;
const organization = { id: 'org-1', slug: 'acme', name: 'Acme Docs', logo: null, orgRole: 'admin', canCreateWebsite: true, websiteCount: 2 } as const;
beforeEach(() => {
  mocks.mutate.mockImplementation((_id: string, options: { onSuccess: () => void }) => options.onSuccess());
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});
const render = async () => {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<DangerSection organization={organization} project={project} />));
  return host;
};

it('says the organization remains, and offers no ownership transfer on a website', async () => {
  const host = await render();
  expect(host.textContent).toContain('settings.danger.delete.websiteDescription:Acme Docs');
  expect(host.textContent).not.toContain('settings.danger.transfer');
});

it('deletes only after the exact website name, then returns to the organization Websites', async () => {
  mocks.prompt.mockResolvedValueOnce('API reference');
  const host = await render();
  await act(async () => host.querySelector('button')?.click());
  const options = mocks.prompt.mock.calls[0]?.[0] as { validate: (value: string) => string | undefined };
  expect(options.validate('API')).toBe('settings.danger.delete.nameMismatch');
  expect(options.validate('API reference')).toBeUndefined();
  expect(mocks.mutate).toHaveBeenCalledWith('site-1', expect.anything());
  expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/o/$orgSlug/websites', params: { orgSlug: 'acme' } });
});

it('does nothing when the prompt is cancelled', async () => {
  mocks.prompt.mockResolvedValueOnce(null);
  const host = await render();
  await act(async () => host.querySelector('button')?.click());
  expect(mocks.mutate).not.toHaveBeenCalled();
});
