// @vitest-environment jsdom

import { Input } from '@nibleaf/design-system/components/ui/input';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const roots: Array<ReturnType<typeof createRoot>> = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
});

/** Renders inside an Arabic (RTL) interface, as the dashboard does in Arabic. */
async function renderRtl(element: ReactElement) {
  const container = document.createElement('div');
  container.dir = 'rtl';
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(element));
  return container.firstElementChild as HTMLInputElement | HTMLTextAreaElement;
}

const PLAINTEXT = '[unicode-bidi:plaintext]';

describe('field text direction in an RTL interface', () => {
  // Fixed-direction values: their base direction must not follow the first letter.
  it.each([
    ['an Arabic-first path', '/دليل/start'],
    ['an email with an Arabic local part', 'سارة@example.com'],
    ['code with an Arabic string', 'const title = "دليل";'],
    ['a URL with an Arabic path', 'https://example.com/دليل/start'],
    ['an ordinary URL', 'https://docs.example.com/start'],
  ])('keeps dir="ltr" for %s', async (_label, value) => {
    for (const element of [<Input defaultValue={value} dir="ltr" key="i" />, <Textarea defaultValue={value} dir="ltr" key="t" />]) {
      const field = await renderRtl(element);
      expect(field.getAttribute('dir')).toBe('ltr');
      expect(field.className).not.toContain(PLAINTEXT);
    }
  });

  it('lets free text without a fixed direction take its own (Latin prose in an Arabic UI)', async () => {
    for (const element of [<Input defaultValue="Product docs." key="i" />, <Textarea defaultValue="Product docs." key="t" />]) {
      const field = await renderRtl(element);
      expect(field.hasAttribute('dir')).toBe(false);
      expect(field.className).toContain(PLAINTEXT);
    }
  });

  it('respects an explicit rtl or auto direction too', async () => {
    expect((await renderRtl(<Input dir="rtl" />)).className).not.toContain(PLAINTEXT);
    expect((await renderRtl(<Textarea dir="auto" />)).className).not.toContain(PLAINTEXT);
  });
});
