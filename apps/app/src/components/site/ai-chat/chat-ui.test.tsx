// @vitest-environment jsdom

import { siteT } from '@nibleaf/i18n/site';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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

const options = { projectId: 'docs', lang: 'en', direction: 'ltr' as const, config: null };
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
