// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ calls: [] as Array<{ projectId: string; query: string; enabled?: boolean }>, lagging: null as string | null }));
const people = [
  { id: 'u1', name: 'Linus Torvalds', email: 'linus@example.com', image: null },
  { id: 'u2', name: null, email: 'lin@example.com', image: null },
];

vi.mock('@nibleaf/i18n/react', () => ({ useT: () => (key: string) => key }));
// Debounce is time-based; the field's behaviour is what matters here.
vi.mock('@tanstack/react-pacer', () => ({ useDebouncedValue: (value: string) => [state.lagging ?? value] }));
vi.mock('@/hooks/api/people', () => ({
  useInviteSuggestions: (projectId: string, query: string, options?: { enabled?: boolean }) => {
    state.calls.push({ projectId, query, enabled: options?.enabled });
    const data = options?.enabled && query.trim() ? people : undefined;
    return { data, isSuccess: Boolean(data) };
  },
}));

import { InviteEmailField } from './invite-email-field';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let current = '';
function Harness() {
  const [value, setValue] = useState('');
  current = value;
  return <InviteEmailField aria-label="email" onChange={setValue} projectId="site-1" value={value} />;
}
const render = async () => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
  return host.querySelector<HTMLInputElement>('input') as HTMLInputElement;
};
const type = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    input.focus();
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const key = (input: HTMLInputElement, name: string) =>
  act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })));

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  state.calls = [];
  state.lagging = null;
});

describe('InviteEmailField', () => {
  it('suggests people from other sites as you type and fills the picked address', async () => {
    const input = await render();
    expect(input.getAttribute('role')).toBe('combobox');
    await type(input, 'lin');
    expect(state.calls.at(-1)).toMatchObject({ projectId: 'site-1', query: 'lin', enabled: true });
    expect(input.getAttribute('aria-expanded')).toBe('true');
    const options = [...host.querySelectorAll('[role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual(['Linus Torvaldslinus@example.com', 'lin@example.com']);

    await key(input, 'ArrowDown');
    await key(input, 'ArrowDown');
    expect(input.getAttribute('aria-activedescendant')).toBe(options[1]?.id);
    await key(input, 'Enter');
    expect(current).toBe('lin@example.com');
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it('stops suggesting once a full address is typed', async () => {
    const input = await render();
    await type(input, 'someone@acme.com');
    expect(state.calls.at(-1)?.enabled).toBe(false);
    expect(host.querySelector('[role="listbox"]')).toBeNull();
  });

  it('closes on Escape and keeps what was typed', async () => {
    const input = await render();
    await type(input, 'lin');
    await key(input, 'Escape');
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    expect(current).toBe('lin');
  });

  it('never shows a list that belongs to an earlier query', async () => {
    const input = await render();
    // The debounced query still says "li" while the box already says "lin".
    state.lagging = 'li';
    await type(input, 'lin');
    expect(host.querySelector('[role="listbox"]')).toBeNull();
    await key(input, 'ArrowDown');
    await key(input, 'Enter');
    expect(current).toBe('lin');
  });
});
