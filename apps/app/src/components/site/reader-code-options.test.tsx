// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MarkdownRenderer } from '../markdown';
import { CodeGroup } from './mdx/code-group';
import { Pre } from './reader-code-block';
import CodeIcon from './reader-code-icon';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

it('expands and collapses without changing copied code or copying gutters', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const text = ['one // [!code ++:2]', 'two', ...Array.from({ length: 18 }, (_, index) => `line${index}`)].join('\n');
  await act(async () => root.render(<MarkdownRenderer content={`\`\`\`js lines expandable focus={1}\n${text}\n\`\`\``} />));
  const toggle = container.querySelector<HTMLButtonElement>('button[aria-expanded]');
  if (!toggle) throw new Error('Missing expansion control');
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(container.querySelector('[data-collapsed]')).not.toBeNull();
  act(() => toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(toggle.textContent).toBe('Show less');
  expect(container.querySelector('[data-collapsed]')).toBeNull();
  expect(container.querySelector('pre')?.tabIndex).toBe(0);
  const copy = container.querySelector<HTMLButtonElement>('button[aria-label="Copy code"]');
  if (!copy) throw new Error('Missing copy control');
  await act(async () => copy.click());
  expect(writeText).toHaveBeenCalledWith(`one\ntwo\n${Array.from({ length: 18 }, (_, index) => `line${index}`).join('\n')}\n`);
  for (const gutter of container.querySelectorAll('.code-gutter')) {
    expect(gutter.getAttribute('aria-hidden')).toBe('true');
    expect(gutter.textContent).toBe('');
  }
  act(() => toggle.click());
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
});

it('selects the active code group panel through a labelled RTL native select', async () => {
  await act(async () =>
    root.render(
      <div dir="rtl">
        <CodeGroup dropdown language="ar">
          <Pre data-title="One">
            <code>one</code>
          </Pre>
          <Pre data-title="Two">
            <code>two</code>
          </Pre>
        </CodeGroup>
      </div>,
    ),
  );
  const select = container.querySelector('select');
  if (!select) throw new Error('Missing language select');
  expect(select.labels?.[0]?.textContent).toContain('لغة الشيفرة');
  expect(select.closest('.reader-code-header')?.querySelector('button[aria-label]')).not.toBeNull();
  expect(select.closest('.reader-code-header')?.textContent).toContain('One');
  act(() => {
    select.value = '1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const panels = container.querySelectorAll<HTMLElement>('[role="region"]');
  expect(panels[0]?.hidden).toBe(true);
  expect(panels[1]?.hidden).toBe(false);
  expect(select.getAttribute('aria-controls')).toBe(panels[1]?.id);
});

it.each(['highlight={1}', 'focus={1}', 'expandable'])('omits empty gutters for %s', async (option) => {
  await act(async () => root.render(<MarkdownRenderer content={`\`\`\`js ${option}\none\ntwo\n\`\`\``} />));
  expect(container.querySelector('.code-line')).not.toBeNull();
  expect(container.querySelector('.code-gutter')).toBeNull();
  expect(container.querySelector('code[data-code-lines]')).not.toBeNull();
});
it.each(['lines', ''])('reserves the marker column on every diff line, with %s', async (numbers) => {
  await act(async () => root.render(<MarkdownRenderer content={`\`\`\`js ${numbers}\none\ntwo // [!code --]\nthree // [!code ++]\nfour\n\`\`\``} />));
  const gutters = [...container.querySelectorAll<HTMLElement>('.code-gutter')];
  expect(gutters).toHaveLength(4);
  expect(gutters.map((gutter) => gutter.dataset.diff)).toEqual(['none', 'remove', 'add', 'none']);
  expect(gutters.map((gutter) => gutter.dataset.number)).toEqual(numbers ? ['1', '2', '3', '4'] : new Array(4).fill(undefined));
  expect(gutters.every((gutter) => gutter.textContent === '')).toBe(true);
});
it.each(['file-code', 'unrecognized-name', 'terminal'])('renders an icon for authored name %s', async (name) => {
  await act(async () => root.render(<CodeIcon name={name} />));
  expect(container.querySelector('svg')).not.toBeNull();
  expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  expect(container.querySelector('svg')?.classList.contains('lucide-terminal')).toBe(name === 'terminal');
});
