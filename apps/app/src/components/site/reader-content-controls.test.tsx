// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownRenderer } from '../markdown';
import { Step, Steps, Tooltip } from './mdx-components';
import { hasIcon, PageIcon } from './page-icon';
import { ContentImage } from './reader-content-controls';

describe('reader content ergonomics', () => {
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
  it('renders an ordered list of steps', async () => {
    await act(async () =>
      root.render(
        <Steps>
          <Step title="First">One</Step>
          <Step>Two</Step>
        </Steps>,
      ),
    );
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
  });
  it('opens tooltips on keyboard focus and dismisses with Escape and toggles on tap', async () => {
    await act(async () => root.render(<Tooltip tip="Explanation">Term</Tooltip>));
    const trigger = container.querySelector('button');
    if (!trigger) throw new Error('Missing tooltip trigger');
    const tip = container.querySelector<HTMLElement>('[role="tooltip"]');
    if (!tip) throw new Error('Missing tooltip');
    expect(trigger.getAttribute('aria-describedby')).toBe(tip.id);
    act(() => trigger.focus());
    expect(tip.hidden).toBe(false);
    act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(tip.hidden).toBe(true);
    act(() => trigger.click());
    expect(tip.hidden).toBe(false);
    act(() => trigger.click());
    expect(tip.hidden).toBe(true);
  });
  it('reports clipboard rejection and success with a live status', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await act(async () => root.render(<MarkdownRenderer content={'```js\nconst a = 1;\n```'} site={{ projectId: 'test', lang: 'en' }} />));
    const button = container.querySelector('button');
    if (!button) throw new Error('Missing copy button');
    await act(async () => button.click());
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Couldn't copy");
    await act(async () => button.click());
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Copied');
    expect(writeText).toHaveBeenLastCalledWith('const a = 1;\n');
  });
  it('preserves heading IDs and text and copies absolute section URLs only in readers', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await act(async () =>
      root.render(<MarkdownRenderer content={'## Getting started\n### Next\n#### Details'} site={{ projectId: 'test', lang: 'en' }} />),
    );
    const buttons = container.querySelectorAll<HTMLButtonElement>('button[aria-label="Copy link to this section"]');
    expect(buttons).toHaveLength(3);
    expect(container.querySelector('h2')?.id).toBe('getting-started');
    expect(container.querySelector('h2')?.textContent).toBe('Getting started');
    await act(async () => buttons[0]?.click());
    expect(writeText).toHaveBeenCalledWith(new URL('#getting-started', window.location.href).href);
    await act(async () => root.render(<MarkdownRenderer content="## Preview" />));
    expect(container.querySelector('button')).toBeNull();
  });
  it('opens full size images, closes on Escape and returns focus', async () => {
    // jsdom does not implement native dialog methods; emulate their DOM events.
    for (const method of ['showModal', 'close']) {
      if (!(method in HTMLDialogElement.prototype))
        Object.defineProperty(HTMLDialogElement.prototype, method, {
          configurable: true,
          writable: true,
          value() {
            /* Replaced by spies below. */
          },
        });
    }
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) {
      this.open = true;
    });
    vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event('close'));
    });
    await act(async () => root.render(<ContentImage src="/large.png" alt="Diagram" language="en" />));
    const image = container.querySelector('img');
    if (!image) throw new Error('Missing image');
    Object.defineProperties(image, { naturalWidth: { value: 800 }, naturalHeight: { value: 600 }, width: { value: 400 }, height: { value: 300 } });
    act(() => image.dispatchEvent(new Event('load')));
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="View full size"]');
    if (!button) throw new Error('Missing image trigger');
    act(() => {
      button.focus();
      button.click();
    });
    // The dialog is portaled to <body> so it never sits inside the image's paragraph.
    const dialog = document.body.querySelector('dialog');
    expect(container.querySelector('dialog')).toBeNull();
    if (!dialog) throw new Error('Missing image dialog');
    expect(dialog.open).toBe(true);
    act(() => dialog.dispatchEvent(new Event('cancel', { cancelable: true })));
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(button);
    act(() => button.click());
    act(() => dialog.querySelector('button')?.click());
    expect(dialog.open).toBe(false);
  });
  it('does not offer zoom for linked images or tiny icons', async () => {
    await act(async () =>
      root.render(
        <>
          <a href="/guide">
            <ContentImage src="/linked.png" alt="Linked" />
          </a>
          <ContentImage src="/icon.png" alt="Icon" />
        </>,
      ),
    );
    for (const image of container.querySelectorAll('img')) {
      const size = image.alt === 'Icon' ? 24 : 800;
      Object.defineProperties(image, {
        naturalWidth: { value: size },
        naturalHeight: { value: size },
        width: { value: size },
        height: { value: size },
      });
      act(() => image.dispatchEvent(new Event('load')));
    }
    expect(container.querySelector('button')).toBeNull();
  });
  it('recognizes lucide aliases and falls back for unknown authored icons', async () => {
    for (const name of ['life-buoy', 'lifebuoy', 'LifeBuoy', 'circle-help']) expect(hasIcon(name)).toBe(true);
    await act(async () => root.render(<PageIcon name="unknown-icon" />));
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
