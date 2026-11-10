// @vitest-environment jsdom

import { Button } from '@nibleaf/design-system/components/ui/button';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import BEFORE from './fixtures/button-markup-before-disabled-reason.json';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
});

async function render(element: ReactElement) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(element));
  return container;
}

const describedIds = (el: Element) => (el.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean);
const describedText = (el: Element) => describedIds(el).map((id) => document.getElementById(id)?.textContent);

describe('Button disabledReason', () => {
  it('stays focusable while blocking activation', async () => {
    const onClick = vi.fn();
    const container = await render(
      <Button disabledReason="Only owners can delete this site" onClick={onClick}>
        Delete
      </Button>,
    );
    const button = container.querySelector('button') as HTMLButtonElement;
    // base-ui focusableWhenDisabled: aria-disabled instead of the disabled attribute.
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('tabindex')).not.toBe('-1');
    await act(async () => button.focus());
    expect(document.activeElement).toBe(button);
    await act(async () => button.click());
    expect(onClick).not.toHaveBeenCalled();
  });

  it('does not submit its form', async () => {
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    const container = await render(
      <form onSubmit={(event) => onSubmit(event.nativeEvent as SubmitEvent)}>
        <input name="name" />
        <Button type="submit" disabledReason="Nothing to save">
          Save
        </Button>
      </form>,
    );
    const button = container.querySelector('button') as HTMLButtonElement;
    await act(async () => button.click());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('links the reason through aria-describedby and keeps an existing description', async () => {
    const container = await render(
      <>
        <p id="existing-hint">Removes the site for everyone</p>
        <Button aria-describedby="existing-hint" disabledReason="Only owners can delete this site">
          Delete
        </Button>
      </>,
    );
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(describedIds(button)[0]).toBe('existing-hint');
    expect(describedText(button)).toEqual(['Removes the site for everyone', 'Only owners can delete this site']);
    // The reason is not part of the button's name.
    expect(button.textContent).toBe('Delete');
    // No interactive element is nested in the button.
    expect(button.querySelector('button, a, input')).toBeNull();
  });

  // Markup recorded from Button before `disabledReason` existed (main at
  // 0a18349c), so buttons that don't use a reason are provably unchanged.
  it.each([
    ['plain', <Button key="a">Save</Button>],
    [
      'outlineSmDisabled',
      <Button disabled key="b" size="sm" variant="outline">
        Save
      </Button>,
    ],
    [
      'loadingIdle',
      <Button key="c" loading={false}>
        Save
      </Button>,
    ],
    [
      'loadingBusy',
      <Button key="d" loading loadingText="Saving…">
        Save
      </Button>,
    ],
    [
      'plain',
      <Button disabledReason={null} key="e">
        Save
      </Button>,
    ],
    [
      'outlineSmDisabled',
      <Button disabled disabledReason={undefined} key="f" size="sm" variant="outline">
        Save
      </Button>,
    ],
  ] as const)('renders %s exactly as before without a reason', (fixture, element) => {
    expect(renderToStaticMarkup(element)).toBe(BEFORE[fixture]);
  });

  it('lets loading win over the reason', async () => {
    const container = await render(
      <Button loading disabledReason="Only owners can delete this site">
        Delete
      </Button>,
    );
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.hasAttribute('aria-describedby')).toBe(false);
    expect(document.body.textContent).not.toContain('Only owners');
  });
});

describe('Button stays light for published docs pages', () => {
  it('imports no tooltip or other primitive', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    // Vitest runs from apps/app.
    const source = readFileSync(resolve(process.cwd(), '../../packages/design-system/src/components/ui/button.tsx'), 'utf8');
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
    expect(imports.filter((path) => path?.startsWith('./'))).toEqual([]);
  });
});
