// @vitest-environment jsdom

import { translateFn } from '@nibleaf/i18n';
import { Editor } from '@tiptap/core';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildEditorExtensions, getMarkdown } from '../tiptap-editor';
import { IsolatedText, isolate } from './bidi';
import { ComponentSettingsLayer } from './component-settings-layer';
import ComponentSettingsPanel from './component-settings-panel';
import { activeComponentTarget, type SettingsTarget, settingsSchemaFor } from './schema';

vi.mock('../extensions/page-link-picker', () => ({
  useLinkablePages: (_editor: unknown, query: string) =>
    [{ id: 'p1', title: 'Installation guide', path: 'guides/install', kind: 'PAGE' }].filter((page) =>
      page.title.toLowerCase().includes(query.toLowerCase()),
    ),
}));

const noop = () => undefined;
beforeAll(() => {
  // Base UI measures popups; jsdom has no layout.
  globalThis.ResizeObserver ??= class {
    observe = noop;
    unobserve = noop;
    disconnect = noop;
  } as unknown as typeof ResizeObserver;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: noop,
    removeEventListener: noop,
    addListener: noop,
    removeListener: noop,
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

let container: HTMLDivElement;
let root: Root;
const editors: Editor[] = [];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = '';
});

const createEditor = (markdown: string) => {
  const element = document.createElement('div');
  document.body.append(element);
  const editor = new Editor({ element, extensions: buildEditorExtensions() });
  editors.push(editor);
  editor.commands.setContent(markdown, { emitUpdate: false });
  return editor;
};

const targetOf = (editor: Editor, nodeName: string): SettingsTarget => {
  let found: SettingsTarget | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (!found && node.type.name === nodeName) found = { pos, nodeName, tag: settingsSchemaFor(nodeName)?.tag ?? '' };
  });
  if (!found) throw new Error(`no ${nodeName}`);
  return found;
};

const renderPanel = async (editor: Editor, nodeName: string) => {
  const target = targetOf(editor, nodeName);
  await act(async () =>
    root.render(createElement(ComponentSettingsPanel, { editor, target, titleId: 'settings-title', onNavigate: () => undefined })),
  );
  return target;
};

const field = (label: string): HTMLElement => {
  const labelElement = [...container.querySelectorAll('label, span[id$="-label"]')].find((element) => element.textContent === label);
  const id = labelElement?.getAttribute('for') ?? labelElement?.id.replace(/-label$/, '');
  const control = id ? document.getElementById(id) : null;
  if (!control) throw new Error(`no field labelled ${label}`);
  return control;
};

const type = async (input: HTMLElement, value: string) => {
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};
const blur = async (input: HTMLElement) => act(async () => input.blur());
const key = async (element: HTMLElement, name: string) => {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
  await act(async () => element.dispatchEvent(event));
  return event;
};
const click = async (element: Element | null | undefined) => act(async () => (element as HTMLElement | null)?.click());

const cardSource = '<Card title="Guide" icon="book" href="/guide">\n\nRead it.\n\n</Card>';

describe('component settings panel', () => {
  it('lists every Card setting with a friendly label and hint, but not the title edited in place', async () => {
    const editor = createEditor(cardSource);
    await renderPanel(editor, 'mdxCard');
    const labels = [...container.querySelectorAll('[data-settings-field] > :first-child')].map((element) => element.textContent);
    expect(labels).toEqual(['Icon', 'Link', 'Compact layout', 'Image', 'Link text', 'Show arrow', 'Icon color']);
    expect(container.querySelector('h2')?.textContent).toBe('Card settings');
    // The visible switch is named by its label and described by its hint.
    const toggle = field('Compact layout').closest('[data-settings-field]')?.querySelector('[role="switch"]');
    expect(toggle?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.getElementById(toggle?.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Puts the icon beside the title.');
    expect(container.textContent).toContain('Puts the icon beside the title.');
  });

  it('applies a switch live, as one undo step', async () => {
    const editor = createEditor(cardSource);
    await renderPanel(editor, 'mdxCard');
    await click(field('Compact layout'));
    expect(getMarkdown(editor)).toContain('<Card title="Guide" icon="book" href="/guide" horizontal>');
    editor.commands.undo();
    expect(getMarkdown(editor)).toContain('<Card title="Guide" icon="book" href="/guide">');
  });

  it('applies typing live and undoes the whole edit in one step', async () => {
    const editor = createEditor(cardSource);
    await renderPanel(editor, 'mdxCard');
    const cta = field('Link text');
    await type(cta, 'R');
    await type(cta, 'Re');
    await type(cta, 'Read more');
    expect(getMarkdown(editor)).toContain('cta="Read more"');
    await blur(cta);
    editor.commands.undo();
    expect(getMarkdown(editor)).not.toContain('cta=');
    editor.commands.redo();
    expect(getMarkdown(editor)).toContain('cta="Read more"');
  });

  it('removes the attribute when a field is emptied', async () => {
    const editor = createEditor('<Card title="Guide" cta="Go" href="/guide">\n\nRead it.\n\n</Card>');
    await renderPanel(editor, 'mdxCard');
    await type(field('Link text'), '');
    await blur(field('Link text'));
    const output = getMarkdown(editor);
    expect(output).toContain('<Card title="Guide" href="/guide">');
    expect(output).not.toContain('cta=');
  });

  it('checks links when the field is left, refuses unsafe ones and never touches the document with them', async () => {
    const editor = createEditor(cardSource);
    await renderPanel(editor, 'mdxCard');
    const link = field('Link');
    await type(link, 'javascript:alert(1)');
    // No error while typing.
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(link.getAttribute('aria-invalid')).toBeNull();
    await blur(link);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('/guide');
    expect(link.getAttribute('aria-invalid')).toBe('true');
    expect(getMarkdown(editor)).toContain('href="/guide"');
    // Typing again clears the error until the next check.
    await type(link, '/ok');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows page suggestions without an error while typing, and picks one with the keyboard', async () => {
    const editor = createEditor(cardSource);
    await renderPanel(editor, 'mdxCard');
    const link = field('Link');
    await type(link, 'Install');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(link.getAttribute('role')).toBe('combobox');
    expect(link.getAttribute('aria-expanded')).toBe('true');
    const listbox = document.getElementById(link.getAttribute('aria-controls') ?? '');
    expect(listbox?.getAttribute('role')).toBe('listbox');
    const option = listbox?.querySelector('[role="option"]');
    expect(option?.textContent).toContain('Installation guide');
    expect(link.getAttribute('aria-activedescendant')).toBeNull();
    await key(link, 'ArrowDown');
    expect(link.getAttribute('aria-activedescendant')).toBe(option?.id);
    expect(option?.getAttribute('aria-selected')).toBe('true');
    await key(link, 'Enter');
    expect(getMarkdown(editor)).toContain('href="/guides/install"');
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('closes the suggestions with Escape without letting the key close the panel', async () => {
    const editor = createEditor(cardSource);
    await renderPanel(editor, 'mdxCard');
    const link = field('Link');
    await type(link, 'Install');
    const closing = await key(link, 'Escape');
    expect(closing.defaultPrevented).toBe(true);
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(link.getAttribute('aria-expanded')).toBe('false');
    // With the list closed, Escape is left to the panel.
    expect((await key(link, 'Escape')).defaultPrevented).toBe(false);
  });

  it('picks the first suggestion on Enter when the text is not a link yet', async () => {
    const editor = createEditor(cardSource);
    await renderPanel(editor, 'mdxCard');
    const link = field('Link');
    await type(link, 'Install');
    await key(link, 'Enter');
    expect(getMarkdown(editor)).toContain('href="/guides/install"');
  });

  it('picks the first matching icon on Enter, and names every result', async () => {
    const editor = createEditor(cardSource);
    await renderPanel(editor, 'mdxCard');
    await click(field('Icon'));
    const search = container.querySelector('input[type="search"]') as HTMLElement;
    await type(search, 'rocket');
    const listbox = document.getElementById(search.getAttribute('aria-controls') ?? '');
    expect(search.getAttribute('role')).toBe('combobox');
    expect(listbox?.getAttribute('role')).toBe('listbox');
    const options = [...(listbox?.querySelectorAll('[role="option"]') ?? [])];
    expect(options.map((option) => option.getAttribute('aria-label'))).toEqual(['rocket']);
    expect(search.getAttribute('aria-activedescendant')).toBe(options[0]?.id);
    await key(search, 'Enter');
    expect(getMarkdown(editor)).toContain('icon="rocket"');
    // The picker closes and focus returns to the icon button.
    expect(document.activeElement).toBe(field('Icon'));
  });

  it.each([
    ['ltr', 'ArrowRight'],
    ['rtl', 'ArrowLeft'],
  ])('moves through the icon grid with the arrow keys (%s)', async (dir, forward) => {
    const editor = createEditor(cardSource);
    const target = targetOf(editor, 'mdxCard');
    await act(async () =>
      root.render(
        createElement(
          'div',
          { dir },
          createElement(ComponentSettingsPanel, { editor, target, titleId: 'settings-title', onNavigate: () => undefined }),
        ),
      ),
    );
    await click(field('Icon'));
    const search = container.querySelector('input[type="search"]') as HTMLElement;
    const options = [...container.querySelectorAll('[role="option"]')];
    expect(options.length).toBeGreaterThan(2);
    expect(options.every((option) => option.getAttribute('aria-label'))).toBe(true);
    await key(search, forward);
    await key(search, forward);
    expect(search.getAttribute('aria-activedescendant')).toBe(options[2]?.id);
    await key(search, forward === 'ArrowRight' ? 'ArrowLeft' : 'ArrowRight');
    expect(search.getAttribute('aria-activedescendant')).toBe(options[1]?.id);
    expect(options[1]?.getAttribute('aria-selected')).toBe('true');
    await key(search, 'Enter');
    expect(getMarkdown(editor)).toContain(`icon="${options[1]?.getAttribute('aria-label')}"`);
  });

  it('isolates the icon name inside the translated button label', async () => {
    const editor = createEditor('<Card title="A" icon="credit-card">\n\nA\n\n</Card>');
    await renderPanel(editor, 'mdxCard');
    const button = field('Icon');
    expect(button.querySelector('bdi')?.textContent).toBe('credit-card');
    expect(button.querySelector('[dir="ltr"]')).toBeNull();
    const arabic = renderToStaticMarkup(
      createElement(IsolatedText, {
        translate: (slots: Record<string, string>) => translateFn('editor.componentSettings.icon.change', slots, 'ar'),
        values: { name: 'credit-card' },
      }),
    );
    expect(arabic).toContain('<bdi>credit-card</bdi>');
    expect(arabic.replace('<bdi>credit-card</bdi>', '')).toMatch(/[\u0600-\u06ff]/);
    expect(isolate('#2563eb')).toBe('\u2068#2563eb\u2069');
  });

  it('sets colors from swatches or a checked hex code', async () => {
    const editor = createEditor(cardSource);
    await renderPanel(editor, 'mdxCard');
    await click(container.querySelector('button[aria-label="Blue"]'));
    expect(getMarkdown(editor)).toContain('color="#2563eb"');
    const hex = field('Icon color');
    await type(hex, '#12');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('#2563eb');
    await type(hex, '#123456');
    await blur(hex);
    expect(getMarkdown(editor)).toContain('color="#123456"');
  });

  it('steps numbers within their bounds and writes them as JSX numbers', async () => {
    const editor = createEditor('<Columns>\n\n<Column>\n\nA\n\n</Column>\n\n</Columns>');
    await renderPanel(editor, 'mdxColumns');
    const increase = container.querySelector('button[aria-label="Increase"]');
    await click(increase);
    await click(increase);
    expect(getMarkdown(editor)).toContain('<Columns cols={2}>');
    for (let index = 0; index < 5; index++) await click(container.querySelector('button[aria-label="Increase"]'));
    expect(getMarkdown(editor)).toContain('<Columns cols={4}>');
  });

  it('shows the first tab one-based and stores it zero-based', async () => {
    const editor = createEditor('<Tabs defaultTabIndex={1}>\n\n<Tab title="A">\n\nA\n\n</Tab>\n\n<Tab title="B">\n\nB\n\n</Tab>\n\n</Tabs>');
    await renderPanel(editor, 'mdxTabs');
    expect((field('Tab shown first') as HTMLInputElement).value).toBe('2');
    await click(container.querySelector('button[aria-label="Decrease"]'));
    expect(getMarkdown(editor)).toContain('<Tabs>');
  });

  it('labels enum options and marks the default', async () => {
    const editor = createEditor('A <Badge color="blue">New</Badge> badge.');
    await renderPanel(editor, 'mdxBadge');
    expect(field('Size').textContent).toContain('Medium (default)');
    expect(field('Shape').textContent).toContain('Rounded (default)');
    // Named badge colors are offered as labelled swatches.
    expect(container.querySelector('button[aria-label="Surface with red text"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Blue"]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('edits list props as chips', async () => {
    const editor = createEditor('<Update label="v2">\n\nNotes\n\n</Update>');
    await renderPanel(editor, 'mdxUpdate');
    const tags = field('Tags');
    await type(tags, 'Feature');
    await act(async () => tags.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    await type(field('Tags'), 'Fix, Docs');
    await act(async () => field('Tags').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(getMarkdown(editor)).toContain('<Update label="v2" tags={["Feature", "Fix", "Docs"]}>');
    const remove = container.querySelector('button[aria-label^="Remove"][aria-label*="Fix"]');
    // The chip's value is isolated in the label so it keeps its own direction.
    expect(remove?.getAttribute('aria-label')).toBe(`Remove ${isolate('Fix')}`);
    await click(remove);
    expect(getMarkdown(editor)).toContain('tags={["Feature", "Docs"]}');
  });

  it('edits a ParamField location and name together', async () => {
    const editor = createEditor('<ParamField query="limit" type="number">\n\nSize.\n\n</ParamField>');
    await renderPanel(editor, 'mdxParamField');
    expect((field('Parameter name') as HTMLInputElement).value).toBe('limit');
    await click(field('Required'));
    expect(getMarkdown(editor)).toContain('<ParamField query="limit" type="number" required>');
  });

  it('shows a code expression read-only and lets the writer clear it', async () => {
    const editor = createEditor('<Card title="A" href={links.home}>\n\nA\n\n</Card>');
    await renderPanel(editor, 'mdxCard');
    expect((field('Link') as HTMLInputElement).readOnly).toBe(true);
    await click([...container.querySelectorAll('button')].find((button) => button.textContent === 'Clear'));
    expect(getMarkdown(editor)).toContain('<Card title="A">');
  });

  it('turns a typed callout into a custom <Callout> from the panel', async () => {
    const editor = createEditor('<Tip>\n\nUseful.\n\n</Tip>');
    await renderPanel(editor, 'callout');
    expect(field('Type').textContent).toContain('Tip');
    await click(container.querySelector('button[aria-label="Purple"]'));
    expect(getMarkdown(editor)).toContain('<Callout type="tip" color="#7c3aed">');
  });
});

describe('opening the settings', () => {
  it('finds the innermost component around the caret', () => {
    const editor = createEditor('<CardGroup cols={2}>\n\n<Card title="A">\n\nInside\n\n</Card>\n\n</CardGroup>');
    let inside = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'Inside') inside = pos + 2;
    });
    editor.commands.setTextSelection(inside);
    expect(activeComponentTarget(editor.state)?.tag).toBe('Card');
  });

  it('opens from the keyboard with Alt+Enter and closes with Escape back to the text', async () => {
    const editor = createEditor(cardSource);
    let inside = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'Read it.') inside = pos + 2;
    });
    editor.commands.setTextSelection(inside);
    editor.commands.focus();
    await act(async () =>
      root.render(createElement('div', { style: { position: 'relative' } }, createElement(ComponentSettingsLayer, { editor, dir: 'ltr' }))),
    );
    const gear = document.querySelector('[data-component-settings-trigger]');
    expect(gear?.getAttribute('aria-label')).toBe('Card settings');
    expect(gear?.getAttribute('aria-keyshortcuts')).toBe('Alt+Enter');
    expect(gear?.getAttribute('title')).toBe(`Card settings (${isolate('Alt+Enter')})`);

    await act(async () => {
      editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true, cancelable: true }));
    });
    // The form loads lazily.
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    const form = document.querySelector('form[data-component-settings="Card"]');
    expect(form).not.toBeNull();
    expect(form?.getAttribute('aria-labelledby')).toBeTruthy();
    expect(document.querySelector('[aria-label="Close settings"]')).not.toBeNull();

    // Escape in the link suggestions closes only the list.
    const link = [...document.querySelectorAll<HTMLInputElement>('input[role="combobox"]')].find((input) => input.inputMode === 'url');
    if (!link) throw new Error('no link field');
    await type(link, 'Install');
    expect(document.querySelector('[role="listbox"]')).not.toBeNull();
    await key(link, 'Escape');
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(document.querySelector('[role="listbox"]')).toBeNull();
    expect(document.querySelector('form[data-component-settings="Card"]')).not.toBeNull();
    // A second Escape closes the panel and returns to the text.
    await act(async () => {
      link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    await act(async () => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(document.querySelector('form[data-component-settings="Card"]')).toBeNull();
    expect(editor.view.hasFocus() || document.activeElement === editor.view.dom).toBe(true);
    expect(editor.state.selection.from).toBe(inside);
  });
});
