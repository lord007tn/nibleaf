// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import rehypeRaw from 'rehype-raw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownRenderer } from '../markdown';
import RichMarkdown from '../markdown-rich';
import { Step, Steps } from './mdx/steps';
import { Tooltip } from './mdx/tooltip';
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
    // A tooltip is not a disclosure: no expanded state is announced.
    expect(trigger.hasAttribute('aria-expanded')).toBe(false);
  });
  it('keeps the tip open while the pointer moves onto it and never nests a link in a button', async () => {
    await act(async () => root.render(<Tooltip tip="Explanation">Term</Tooltip>));
    const wrapper = container.firstElementChild as HTMLElement;
    const trigger = container.querySelector('button');
    const tip = container.querySelector<HTMLElement>('[role="tooltip"]');
    if (!trigger || !tip) throw new Error('Missing tooltip parts');
    // React's onMouseEnter/onMouseLeave listen to mouseover/mouseout with relatedTarget.
    act(() => trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: document.body })));
    expect(tip.hidden).toBe(false);
    act(() => trigger.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: tip })));
    expect(tip.hidden).toBe(false);
    act(() => tip.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })));
    expect(tip.hidden).toBe(true);
    expect(wrapper.contains(tip)).toBe(true);
    await act(async () =>
      root.render(
        <Tooltip tip="Explanation">
          <a href="/guide">Guide</a>
        </Tooltip>,
      ),
    );
    expect(container.querySelector('button')).toBeNull();
    const link = container.querySelector('a[href="/guide"]');
    const linkedTip = container.querySelector('[role="tooltip"]');
    // Screen readers hear the tip from the link itself.
    expect(link?.getAttribute('aria-describedby')).toBe(linkedTip?.id);
  });
  it('reports clipboard rejection and success through one shared live region', async () => {
    const writeText = vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await act(async () =>
      root.render(
        <MarkdownRenderer content={'## Setup\n\n```js\nconst a = 1;\n```\n\n```js\nconst b = 2;\n```'} site={{ projectId: 'test', lang: 'en' }} />,
      ),
    );
    // No per-heading or per-code-block live regions.
    expect(container.querySelectorAll('[role="status"]')).toHaveLength(0);
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Copy code"]');
    if (!button) throw new Error('Missing copy button');
    const announcer = () => [...document.querySelectorAll('[data-reader-announcer]')];
    await act(async () => button.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 80)));
    expect(announcer()).toHaveLength(1);
    expect(announcer()[0]?.textContent).toContain("Couldn't copy");
    expect(container.textContent).toContain("Couldn't copy");
    await act(async () => button.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 80)));
    expect(announcer()).toHaveLength(1);
    expect(announcer()[0]?.textContent).toBe('Copied');
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
    // Each button is described by its own heading, so a list of buttons tells them apart.
    expect([...buttons].map((button) => button.getAttribute('aria-describedby'))).toEqual(['getting-started', 'next', 'details']);
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
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="View full size: Diagram"]');
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
    // The full-size copy exists only while the dialog is open: no second image per picture.
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe('/large.png');
    act(() => dialog.dispatchEvent(new Event('cancel', { cancelable: true })));
    expect(dialog.open).toBe(false);
    expect(dialog.querySelector('img')).toBeNull();
    expect(document.activeElement).toBe(button);
    act(() => button.click());
    act(() => dialog.querySelector('button')?.click());
    expect(dialog.open).toBe(false);
  });
  it('keeps authored image classes, such as light/dark image pairs, over the default frame', async () => {
    await act(async () =>
      root.render(
        <MarkdownRenderer
          content={'<img src="/light.png" alt="Light" class="block dark:hidden" />'}
          site={{ projectId: 'test', lang: 'en' }}
          extraRehypePlugins={[rehypeRaw]}
        />,
      ),
    );
    // The wrapper copies the visibility classes, so the image and its zoom button hide together;
    // the image itself keeps every authored class.
    const wrapper = container.querySelector('.reader-image');
    expect(wrapper?.className).toContain('dark:hidden');
    expect(wrapper?.className).toContain('block');
    expect(wrapper?.className).not.toContain('inline-block');
    expect(container.querySelector('img')?.className).toBe('rounded-xl border border-border block dark:hidden');
  });
  it('keeps centered images centered and lets a Frame hold a light/dark image pair', async () => {
    await act(async () =>
      root.render(
        // Authored component tags render through the rich renderer, which owns their renderers.
        <RichMarkdown
          content={
            '<img src="/centered.png" alt="Centered" class="block mx-auto" />\n\n<Frame>\n\n<img src="/light.png" alt="Light" class="block dark:hidden" />\n<img src="/dark.png" alt="Dark" class="hidden dark:block" />\n\n</Frame>'
          }
          site={{ projectId: 'test', lang: 'en' }}
        />,
      ),
    );
    const [centered, light, dark] = [...container.querySelectorAll<HTMLElement>('.reader-image')];
    // The wrapper shrinks to the image and centers, so `mx-auto` keeps working.
    expect(centered?.className).toContain('mx-auto');
    expect(centered?.className).toContain('w-fit');
    expect(centered?.querySelector('img')?.className).toContain('mx-auto');
    // The Frame sizes the wrapper but never forces it visible.
    expect(light?.className).toContain('dark:hidden');
    expect(dark?.className).toContain('hidden');
    expect(dark?.parentElement?.className).not.toContain('[&>.reader-image]:block');
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
  it('recognizes lucide aliases and leaves unknown authored icons to the caller', async () => {
    for (const name of ['life-buoy', 'lifebuoy', 'LifeBuoy', 'circle-help']) expect(hasIcon(name)).toBe(true);
    for (const name of ['constructor', '__proto__', 'unknown-icon']) expect(hasIcon(name)).toBe(false);
    await act(async () => root.render(<PageIcon name="life-buoy" />));
    expect(container.querySelector('svg')).not.toBeNull();
    // Unknown names render nothing, so inline <Icon> and the sidebar don't show a stray document icon.
    await act(async () => root.render(<PageIcon name="unknown-icon" />));
    expect(container.querySelector('svg')).toBeNull();
  });
});
