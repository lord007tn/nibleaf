// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  mutateAsync: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@nibleaf/i18n/react', () => ({
  useT: () => (key: string, vars?: Record<string, string>) => (vars ? `${key}(${Object.values(vars).join('|')})` : key),
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('sonner', () => ({ toast: { success: mocks.toastSuccess, error: mocks.toastError } }));
vi.mock('@/hooks/api', () => ({ useCreateOrganization: () => ({ mutateAsync: mocks.mutateAsync }) }));

import { CreateOrganizationDialog } from './create-organization-dialog';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
let root: ReturnType<typeof createRoot>;
const onOpenChange = vi.fn();

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    },
  );
  mocks.mutateAsync.mockResolvedValue({ id: 'org-9', slug: 'acme-docs-2', name: 'Acme Docs' });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});

async function render() {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<CreateOrganizationDialog onOpenChange={onOpenChange} open />));
}
const input = () => document.querySelector<HTMLInputElement>('[role="dialog"] input') as HTMLInputElement;
const submit = () => document.querySelector<HTMLButtonElement>('button[type="submit"]') as HTMLButtonElement;
const type = (value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
const flush = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

describe('create organization dialog', () => {
  it('disables Create while the name is empty or blank', async () => {
    await render();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('organization.create.title');
    expect(submit().textContent).toContain('organization.create.submit');
    expect(submit().disabled).toBe(true);
    await type('   ');
    expect(submit().disabled).toBe(true);
    await type('Acme');
    expect(submit().disabled).toBe(false);
  });

  it('creates with the trimmed name and lands on the new org Websites page', async () => {
    await render();
    await type('  Acme Docs  ');
    await act(async () => submit().click());
    await flush();
    expect(mocks.mutateAsync).toHaveBeenCalledWith({ name: 'Acme Docs' });
    expect(mocks.toastSuccess).toHaveBeenCalledWith('organization.create.created(Acme Docs)');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/app/o/$orgSlug/websites', params: { orgSlug: 'acme-docs-2' } });
    expect(mocks.toastError).not.toHaveBeenCalled();
  });

  it('shows an error toast and stays open when creating fails', async () => {
    mocks.mutateAsync.mockRejectedValue(new Error('boom'));
    await render();
    await type('Acme');
    await act(async () => submit().click());
    await flush();
    expect(mocks.toastError).toHaveBeenCalledWith('organization.create.error');
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(input().value).toBe('Acme');
  });

  it('Cancel closes without creating', async () => {
    await render();
    const cancel = [...document.querySelectorAll('button')].find((button) => button.textContent === 'common.cancel');
    await act(async () => cancel?.click());
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocks.mutateAsync).not.toHaveBeenCalled();
  });
});
