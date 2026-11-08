// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SitePrivateGate, { type PrivateSiteGate } from './site-private-gate';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const gate = (overrides: Partial<PrivateSiteGate> = {}): PrivateSiteGate => ({
  projectId: 'site-1',
  name: 'Acme Docs',
  mode: 'READERS',
  language: { code: 'en', direction: 'LTR' },
  config: null,
  ...overrides,
});

const answer = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('private site sign-in screen', () => {
  let container: HTMLDivElement;
  let root: Root;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/sites/site-1/guide');
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  });

  const render = async (props: Partial<Parameters<typeof SitePrivateGate>[0]> = {}) => {
    await act(async () => root.render(<SitePrivateGate gate={gate()} projectId="site-1" {...props} />));
  };
  const type = async (selector: string, value: string) => {
    const input = container.querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error(`no ${selector}`);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const submit = async () => {
    await act(async () => container.querySelector('form')?.requestSubmit());
  };

  it('renders in the site’s own name and language on the server, without any page content', () => {
    const html = renderToString(<SitePrivateGate gate={gate({ language: { code: 'ar', direction: 'RTL' } })} projectId="site-1" />);
    expect(html).toContain('Acme Docs');
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
  });

  it('explains the team-only mode differently from invited readers', async () => {
    await render({ gate: gate({ mode: 'WORKSPACE' }) });
    expect(container.textContent).toContain('only for the team');
    await render({ gate: gate({ mode: 'READERS' }) });
    expect(container.textContent).toContain('you were invited with');
  });

  it('asks for a code, then signs in with it', async () => {
    fetchMock
      .mockResolvedValueOnce(answer(200, { data: { sent: true } }))
      .mockResolvedValueOnce(answer(400, { error: { code: 'http:bad_request' } }));
    await render();
    await type('input[type="email"]', 'reader@example.com');
    await submit();
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/public/reader-access/sign-in/site-1/start', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body)).toEqual({ email: 'reader@example.com', lang: 'en' });
    expect(container.textContent).toContain('If reader@example.com can read this documentation');

    await type('input[autocomplete="one-time-code"]', '12 34-56');
    expect(container.querySelector<HTMLInputElement>('input[autocomplete="one-time-code"]')?.value).toBe('123456');
    await submit();
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/public/reader-access/sign-in/site-1/verify', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body)).toEqual({ email: 'reader@example.com', code: '123456' });
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('wrong or has expired');
  });

  it('says to wait when the sign-in is rate limited', async () => {
    fetchMock.mockResolvedValueOnce(answer(429));
    await render();
    await type('input[type="email"]', 'reader@example.com');
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Too many attempts');
  });

  it('takes an invitation from the URL fragment, removes it from the address bar and accepts it only on a click', async () => {
    window.history.replaceState(null, '', '/sites/site-1#reader-invite=invite-token-1234567890');
    fetchMock.mockResolvedValueOnce(answer(404));
    await render();
    expect(window.location.hash).toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("You're invited to read Acme Docs");
    await submit();
    expect(fetchMock).toHaveBeenCalledWith('/api/public/reader-access/accept', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body)).toEqual({ token: 'invite-token-1234567890' });
    // A used or expired invitation falls back to the email code.
    expect(container.querySelector('[role="status"]')?.textContent).toContain('already used');
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
  });

  it('signs in with a code and returns to the requested page with its query', async () => {
    window.history.replaceState(null, '', '/sites/site-1/guide?lang=ar');
    const onSignedIn = vi.fn();
    fetchMock.mockResolvedValueOnce(answer(200, { data: { sent: true } })).mockResolvedValueOnce(answer(200, { data: { ok: true } }));
    await render({ onSignedIn });
    await type('input[type="email"]', 'reader@example.com');
    await submit();
    await type('input[autocomplete="one-time-code"]', '123456');
    await submit();
    expect(onSignedIn).toHaveBeenCalledOnce();
    // Nothing navigated away: reloading this URL is the return to the page.
    expect(`${window.location.pathname}${window.location.search}`).toBe('/sites/site-1/guide?lang=ar');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('accepts an invitation and opens the documentation at the same address', async () => {
    window.history.replaceState(null, '', '/sites/site-1?lang=ar#reader-invite=invite-token-1234567890');
    const onSignedIn = vi.fn();
    fetchMock.mockResolvedValueOnce(answer(200, { data: { ok: true } }));
    await render({ onSignedIn });
    await submit();
    expect(onSignedIn).toHaveBeenCalledOnce();
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe('/sites/site-1?lang=ar');
  });

  it('keeps the invitation after a server error so the reader can try again', async () => {
    window.history.replaceState(null, '', '/sites/site-1#reader-invite=invite-token-1234567890');
    fetchMock.mockResolvedValueOnce(answer(503));
    await render();
    await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Something went wrong');
    expect(container.querySelector('input[type="email"]')).toBeNull();
    expect(container.textContent).toContain("You're invited to read Acme Docs");
  });

  it('offers the email code for a damaged invitation link instead of failing', async () => {
    window.history.replaceState(null, '', '/sites/site-1#reader-invite=%E0%A4');
    await render();
    expect(window.location.hash).toBe('');
    expect(container.querySelector('input[type="email"]')).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
