// @vitest-environment jsdom

import { siteT } from '@nibleaf/i18n/site';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectConfig } from '@/hooks/api/types';
import { ChatRoot } from './chat-ui';
import type { ChatRequest } from './provider';

const mocks = vi.hoisted(() => ({ replace: vi.fn(), panel: vi.fn() }));
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ history: { replace: mocks.replace } }) }));
vi.mock('./panel', () => ({
  default: (props: { open: boolean; request?: ChatRequest; onOpenChange: (open: boolean) => void; requiresConsent: boolean }) => {
    mocks.panel(props);
    return props.open ? <div data-testid="panel">{props.request?.question ?? props.request?.source}</div> : null;
  },
}));
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const options = { projectId: 'docs', lang: 'en', direction: 'ltr' as const, config: null, questionRetentionDays: null };
const roots: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const unmount of roots.splice(0)) await unmount();
  document.body.replaceChildren();
  window.history.replaceState(null, '', '/');
  vi.clearAllMocks();
});
// Load the lazy panel up front so a cold import can't outlast `act`.
beforeAll(async () => {
  await import('./panel');
});

const mount = async (node: ReactNode) => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = (next: ReactNode) => act(async () => root.render(next));
  roots.push(() => act(async () => root.unmount()));
  await render(node);
  return { container, render };
};
const launcher = () => [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Ask AI'));
const request = (id: number, question?: string): ChatRequest => ({ id, question, source: 'search_handoff', trigger: null });

describe('ChatRoot', () => {
  it('opens the panel for each new request and keeps it closed until the next one', async () => {
    const openChat = vi.fn();
    const view = await mount(<ChatRoot {...options} openChat={openChat} />);
    expect(view.container.querySelector('[data-testid="panel"]')).toBeNull();
    await view.render(<ChatRoot {...options} openChat={openChat} request={request(1, 'How do I start?')} />);
    expect(view.container.querySelector('[data-testid="panel"]')?.textContent).toBe('How do I start?');
    const { onOpenChange } = mocks.panel.mock.lastCall?.[0] ?? {};
    await act(async () => onOpenChange?.(false));
    expect(view.container.querySelector('[data-testid="panel"]')).toBeNull();
    await view.render(<ChatRoot {...options} openChat={openChat} request={request(1, 'How do I start?')} />);
    expect(view.container.querySelector('[data-testid="panel"]')).toBeNull();
    await view.render(<ChatRoot {...options} openChat={openChat} request={request(2, 'And then?')} />);
    expect(view.container.querySelector('[data-testid="panel"]')?.textContent).toBe('And then?');
  });

  it('asks a deep-linked question once and drops only `ask` from the address', async () => {
    window.history.replaceState(null, '', '/docs/guide?lang=en&ask=How%3F#install');
    const openChat = vi.fn();
    const view = await mount(<ChatRoot {...options} openChat={openChat} ask="How?" />);
    expect(openChat).toHaveBeenCalledExactlyOnceWith({ question: 'How?', source: 'deep_link' });
    expect(mocks.replace).toHaveBeenCalledExactlyOnceWith('/docs/guide?lang=en#install');
    await view.render(<ChatRoot {...options} openChat={openChat} ask="How?" />);
    expect(openChat).toHaveBeenCalledOnce();
    // Once the address no longer carries it, the same question can be deep-linked again.
    await view.render(<ChatRoot {...options} openChat={openChat} />);
    await view.render(<ChatRoot {...options} openChat={openChat} ask="How?" />);
    expect(openChat).toHaveBeenCalledTimes(2);
  });

  it('opens from the launcher and returns focus to it when the panel closes without a trigger', async () => {
    const openChat = vi.fn();
    const view = await mount(<ChatRoot {...options} openChat={openChat} />);
    await act(async () => launcher()?.click());
    expect(openChat).toHaveBeenCalledExactlyOnceWith({ source: 'launcher' });
    await view.render(<ChatRoot {...options} openChat={openChat} request={{ ...request(1), source: 'launcher' }} />);
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    await act(async () => mocks.panel.mock.lastCall?.[0].onOpenChange(false));
    expect(document.activeElement).toBe(launcher());
    frame.mockRestore();
  });

  it('returns focus to the launcher after a deep-linked question, which has no trigger', async () => {
    const openChat = vi.fn();
    const view = await mount(<ChatRoot {...options} openChat={openChat} />);
    await view.render(<ChatRoot {...options} openChat={openChat} request={{ ...request(1, 'How?'), source: 'deep_link', trigger: document.body }} />);
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    await act(async () => mocks.panel.mock.lastCall?.[0].onOpenChange(false));
    expect(document.activeElement).toBe(launcher());
    frame.mockRestore();
  });

  it('steps the launcher aside while the analytics consent banner shows', async () => {
    const config = { analytics: { cookieConsent: true, plausible: 'docs.example.com' } } as ProjectConfig;
    const banner = document.createElement('section');
    banner.setAttribute('aria-label', siteT('en')('analyticsConsentTitle'));
    document.body.append(banner);
    const view = await mount(<ChatRoot {...options} config={config} openChat={vi.fn()} />);
    expect(launcher()).toBeUndefined();
    await act(async () => banner.remove());
    expect(launcher()).toBeDefined();
    await view.render(<ChatRoot {...options} config={config} openChat={vi.fn()} request={request(1)} />);
    expect(mocks.panel.mock.lastCall?.[0].requiresConsent).toBe(true);
  });
});

describe('launcher on phones', () => {
  // A 390×844 phone. The launcher's box sits 16px in from the inline end and
  // 16px up, 48px square, as `end-4` and its offset place it.
  const VIEW = { width: 390, height: 844 };
  const boxes = new WeakMap<Element, { left: number; top: number; width: number; height: number }>();
  const rect = ({ left, top, width, height }: { left: number; top: number; width: number; height: number }) =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
  const launcherBox = () => ({
    left: document.documentElement.dir === 'rtl' ? 16 : VIEW.width - 16 - 48,
    top: VIEW.height - 16 - 48,
    width: 48,
    height: 48,
  });
  /** Places an element on screen, or off it after a scroll. */
  const place = (element: Element, box: { left: number; top: number; width: number; height: number }) => boxes.set(element, box);

  /** IntersectionObserver as browsers run it for these options: the viewport,
   * shrunk by `rootMargin`, against each target's box. */
  class FakeIntersectionObserver {
    static live = new Set<FakeIntersectionObserver>();
    readonly targets = new Map<Element, boolean | undefined>();
    constructor(
      private readonly callback: IntersectionObserverCallback,
      private readonly options: IntersectionObserverInit = {},
    ) {
      FakeIntersectionObserver.live.add(this);
    }
    /** Real observers report a frame after `observe`; tests can hold that back. */
    static deferred = false;
    observe(target: Element) {
      this.targets.set(target, undefined);
      if (!FakeIntersectionObserver.deferred) this.check();
    }
    unobserve(target: Element) {
      this.targets.delete(target);
    }
    disconnect() {
      this.targets.clear();
      FakeIntersectionObserver.live.delete(this);
    }
    takeRecords() {
      return [];
    }
    check() {
      const [top = 0, right = 0, bottom = 0, left = 0] = (this.options.rootMargin ?? '0px').split(' ').map((side) => -Number.parseFloat(side));
      const root = { left, top, right: VIEW.width - right, bottom: VIEW.height - bottom };
      const entries: IntersectionObserverEntry[] = [];
      for (const [target, was] of this.targets) {
        const box = target.getBoundingClientRect();
        const isIntersecting =
          box.width > 0 && box.height > 0 && box.left < root.right && box.right > root.left && box.top < root.bottom && box.bottom > root.top;
        if (isIntersecting === was) continue;
        this.targets.set(target, isIntersecting);
        entries.push({ target, isIntersecting } as IntersectionObserverEntry);
      }
      if (entries.length) this.callback(entries, this as unknown as IntersectionObserver);
    }
  }
  /** The browser re-checks every observed control as the page scrolls. */
  const scrollControls = () =>
    act(async () => {
      for (const observer of FakeIntersectionObserver.live) observer.check();
    });
  const scrollTo = (y: number) =>
    act(async () => {
      Object.defineProperty(window, 'scrollY', { configurable: true, value: y });
      window.dispatchEvent(new Event('scroll'));
    });
  let phone = true;
  let page: HTMLElement;
  beforeEach(() => {
    phone = true;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: VIEW.width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: VIEW.height });
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    window.matchMedia = vi.fn(
      (query: string) =>
        ({
          matches: phone && query.includes('max-width: 767px'),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }) as unknown as MediaQueryList,
    );
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return rect(this.matches('[data-chat-launcher]') ? launcherBox() : (boxes.get(this) ?? { left: 0, top: 0, width: 0, height: 0 }));
    });
    // The article: a screenshot with its zoom button, and the pager.
    page = document.createElement('main');
    page.innerHTML =
      '<figure><img alt=""><button type="button">Zoom</button></figure><nav><a href="/prev">Previous</a><a href="/next">Next</a></nav>';
    document.body.append(page);
  });
  afterEach(() => {
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    document.documentElement.dir = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    FakeIntersectionObserver.live.clear();
    FakeIntersectionObserver.deferred = false;
  });
  const control = (name: string) => [...page.querySelectorAll('a, button')].find((element) => element.textContent === name) as HTMLElement;
  const away = () => launcher()?.hasAttribute('data-away');

  it('is named "Ask AI" for screen readers, with its icon hidden from them', async () => {
    await mount(<ChatRoot {...options} openChat={vi.fn()} />);
    expect(launcher()?.textContent).toBe('Ask AI');
    expect(launcher()?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(away()).toBe(false);
  });

  it('stays away while a screenshot zoom button is under it, and returns once it scrolls clear', async () => {
    // Under the launcher's corner.
    place(control('Zoom'), { left: 330, top: 784, width: 40, height: 40 });
    // The pager's other end is not.
    place(control('Previous'), { left: 16, top: 790, width: 120, height: 40 });
    await mount(<ChatRoot {...options} openChat={vi.fn()} />);
    expect(away()).toBe(true);
    place(control('Zoom'), { left: 330, top: 300, width: 40, height: 40 });
    await scrollControls();
    expect(away()).toBe(false);
  });

  it('does not come back on scroll up while a control is under it', async () => {
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 5000 });
    await mount(<ChatRoot {...options} openChat={vi.fn()} />);
    await scrollTo(400);
    expect(away()).toBe(true);
    // The pager's Next link scrolls in under it as the reader scrolls back up.
    place(control('Next'), { left: 300, top: 770, width: 80, height: 44 });
    await scrollControls();
    await scrollTo(300);
    expect(away()).toBe(true);
    place(control('Next'), { left: 300, top: 600, width: 80, height: 44 });
    await scrollControls();
    expect(away()).toBe(false);
  });

  it('stays away, without a flicker, while it re-measures after a resize', async () => {
    place(control('Zoom'), { left: 330, top: 784, width: 40, height: 40 });
    await mount(<ChatRoot {...options} openChat={vi.fn()} />);
    expect(away()).toBe(true);
    // A resize rebuilds the observer; its first report comes a frame later.
    FakeIntersectionObserver.deferred = true;
    await act(async () => {
      window.dispatchEvent(new Event('resize'));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(FakeIntersectionObserver.live.size).toBe(1);
    expect(away()).toBe(true);
    await scrollControls();
    expect(away()).toBe(true);
  });

  it('counts a control just next to it, which is as hard to tap', async () => {
    // 4px left of the launcher's box.
    place(control('Zoom'), { left: 290, top: 790, width: 32, height: 32 });
    await mount(<ChatRoot {...options} openChat={vi.fn()} />);
    expect(away()).toBe(true);
  });

  it('watches the inline-start corner in a right-to-left page', async () => {
    document.documentElement.dir = 'rtl';
    // The pager's first link sits at the bottom left, where the launcher is in RTL.
    place(control('Previous'), { left: 20, top: 786, width: 120, height: 40 });
    place(control('Zoom'), { left: 330, top: 784, width: 40, height: 40 });
    await mount(<ChatRoot {...options} openChat={vi.fn()} />);
    expect(away()).toBe(true);
    place(control('Previous'), { left: 20, top: 200, width: 120, height: 40 });
    await scrollControls();
    // The zoom button at the right is clear of it.
    expect(away()).toBe(false);
  });

  it('notices controls a client navigation adds under it', async () => {
    await mount(<ChatRoot {...options} openChat={vi.fn()} />);
    expect(away()).toBe(false);
    const copy = document.createElement('button');
    copy.textContent = 'Copy';
    place(copy, { left: 334, top: 790, width: 36, height: 36 });
    await act(async () => {
      page.append(copy);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(away()).toBe(true);
  });

  it('comes back for keyboard focus, even over a control', async () => {
    place(control('Zoom'), { left: 330, top: 784, width: 40, height: 40 });
    await mount(<ChatRoot {...options} openChat={vi.fn()} />);
    expect(away()).toBe(true);
    await act(async () => launcher()?.focus());
    expect(away()).toBe(false);
    await act(async () => launcher()?.blur());
    expect(away()).toBe(true);
  });

  it('never steps aside for controls on wider screens, where it is a labelled pill', async () => {
    phone = false;
    place(control('Zoom'), { left: 330, top: 784, width: 40, height: 40 });
    await mount(<ChatRoot {...options} openChat={vi.fn()} />);
    expect(away()).toBe(false);
  });

  it('slides away while the reader scrolls down and comes back on scroll up', async () => {
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 5000 });
    await mount(<ChatRoot {...options} openChat={vi.fn()} />);
    expect(away()).toBe(false);
    await scrollTo(400);
    expect(away()).toBe(true);
    await scrollTo(395);
    // A jitter of a few pixels changes nothing.
    expect(away()).toBe(true);
    await scrollTo(300);
    expect(away()).toBe(false);
  });

  it('reserves room at the end of the page for its offset, its 3rem and the safe area', async () => {
    const view = await mount(<ChatRoot {...options} openChat={vi.fn()} />);
    const offset = () => (view.container.querySelector<HTMLElement>('[data-chat-launcher]')?.style.bottom ?? '').match(/^calc\((.+) \+ env/u)?.[1];
    const room = () => view.container.querySelector<HTMLElement>('[data-chat-launcher-space]')?.style.height;
    expect(offset()).toBe('1rem');
    expect(room()).toBe(`calc(${offset()} + 3rem + env(safe-area-inset-bottom))`);
    // Above the consent "Manage" button when the site asks for consent.
    const consent = { analytics: { cookieConsent: true } } as ProjectConfig;
    await view.render(<ChatRoot {...options} config={consent} openChat={vi.fn()} />);
    expect(offset()).toBe('4.5rem');
    expect(room()).toBe(`calc(${offset()} + 3rem + env(safe-area-inset-bottom))`);
  });
});
