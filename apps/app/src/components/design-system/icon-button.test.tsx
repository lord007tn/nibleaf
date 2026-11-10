// @vitest-environment jsdom

import { IconButton } from '@nibleaf/design-system/components/ui/icon-button';
import { TrashIcon } from 'lucide-react';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

describe('IconButton', () => {
  it('is named by its label', async () => {
    const onClick = vi.fn();
    const container = await render(
      <IconButton label="Delete page" onClick={onClick}>
        <TrashIcon aria-hidden />
      </IconButton>,
    );
    const buttons = container.querySelectorAll('button');
    expect(buttons).toHaveLength(1);
    const button = buttons[0] as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Delete page');
    expect(button.textContent).toBe('');
    expect(button.className).toContain('size-(--control-size-compact)');
    await act(async () => button.click());
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('keeps the label as its name and describes the disabled reason', async () => {
    const onClick = vi.fn();
    const container = await render(
      <IconButton label="Delete page" disabledReason="The home page can't be deleted" onClick={onClick} size="icon">
        <TrashIcon aria-hidden />
      </IconButton>,
    );
    const button = container.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Delete page');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    const reasonId = button.getAttribute('aria-describedby');
    expect(reasonId && document.getElementById(reasonId)?.textContent).toBe("The home page can't be deleted");
    await act(async () => button.click());
    expect(onClick).not.toHaveBeenCalled();
  });
});
