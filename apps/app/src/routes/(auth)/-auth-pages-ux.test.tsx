// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Meta = { signupDisabled: boolean; providers: { google: boolean } };

const mocks = vi.hoisted(() => ({
  locale: 'en' as 'en' | 'ar',
  loaderData: null as Meta | null,
  send: vi.fn(),
  verify: vi.fn(),
  navigate: vi.fn(),
}));

vi.mock('@nibleaf/i18n/react', async () => {
  const [{ default: ar }, { default: en }, { MESSAGE_IDS }] = await Promise.all([
    import('../../../../../packages/i18n/messages/ar.json'),
    import('../../../../../packages/i18n/messages/en.json'),
    import('../../../../../packages/i18n/src/message-ids'),
  ]);
  const t = (key: keyof typeof MESSAGE_IDS, variables?: Record<string, string | number>) =>
    String((mocks.locale === 'ar' ? ar : en)[MESSAGE_IDS[key] as keyof typeof en]).replace(/\{(\w+)\}/g, (_, name) =>
      String(variables?.[name] ?? ''),
    );
  return { useT: () => t, useLocale: () => ({ t, locale: mocks.locale }) };
});
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useSearch: () => ({}), useLoaderData: () => mocks.loaderData }),
  useNavigate: () => mocks.navigate,
  useRouter: () => ({ history: { push: mocks.navigate, replace: mocks.navigate } }),
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));
// The query never answers: whatever the page shows comes from the loader's copy.
vi.mock('@/hooks/api/query-options', () => ({
  getPublicMetaQueryOptions: () => ({ queryKey: ['public', 'meta'], queryFn: () => new Promise(() => undefined), staleTime: 300_000 }),
}));
vi.mock('@/integrations/tanstack-query/query-client', () => ({ loadRouteData: vi.fn() }));
vi.mock('@/components/interface-language-dialog', () => ({ InterfaceLanguageButton: () => <button type="button">language</button> }));
vi.mock('@/services/auth-client', () => ({
  authClient: { emailOtp: { sendVerificationOtp: mocks.send }, signIn: { emailOtp: mocks.verify } },
  signIn: { social: vi.fn() },
}));
vi.mock('@/lib/invitations', () => ({ afterAuthDestination: () => null }));

import { authDocumentTitle } from '@/lib/auth-document-title';
import { Route as SignInRoute } from './sign-in';
import { Route as SignUpRoute } from './sign-up';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
// input-otp checks password-manager badge geometry; jsdom has no hit testing.
document.elementFromPoint = () => null;
const signIn = SignInRoute.options.component as unknown as ComponentType;
const signUp = SignUpRoute.options.component as unknown as ComponentType;
const pages = [
  ['sign-in', signIn],
  ['sign-up', signUp],
] as const;
const withQueries = (Page: ComponentType) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <Page />
  </QueryClientProvider>
);

describe('auth pages', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.locale = 'en';
    mocks.loaderData = { signupDisabled: false, providers: { google: true } };
    mocks.send.mockResolvedValue({ error: null });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  const render = (Page: ComponentType) => act(async () => root.render(withQueries(Page)));
  const button = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.trim().startsWith(label));
  async function enter(selector: string, value: string) {
    const input = container.querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error(`Missing input: ${selector}`);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
  const submit = () => act(async () => container.querySelector<HTMLButtonElement>('button[type="submit"]')?.click());
  async function reachCodeStep(Page: ComponentType, email = 'ada.lovelace.with.a.long.address@analytical-engine.example') {
    await render(Page);
    if (container.querySelector('#name')) await enter('#name', 'Ada');
    await enter('#email', email);
    await submit();
    expect(container.querySelector('[data-input-otp]')).not.toBeNull();
  }

  describe('PUBLIC-10: the first render is the final form', () => {
    it.each(pages)('%s renders Google in the server HTML from the loader, with no placeholder', (_name, Page) => {
      const html = renderToString(withQueries(Page));
      expect(html).toContain('with Google');
      expect(html).toContain('<form');
      expect(html).not.toContain('role="status"');
    });

    it.each(pages)('%s hydrates to the same structure the server sent (no Google pop-in)', async (_name, Page) => {
      const host = document.createElement('div');
      host.innerHTML = renderToString(withQueries(Page));
      await render(Page);
      const shape = (node: Element) => [...node.querySelectorAll('button, input, form, a')].map((element) => element.tagName).join();
      expect(shape(container)).toBe(shape(host));
    });

    it('omits Google from the first HTML when the instance has none', () => {
      mocks.loaderData = { signupDisabled: false, providers: { google: false } };
      expect(renderToString(withQueries(signUp))).not.toContain('with Google');
    });

    it.each([
      ['/sign-in', SignInRoute],
      ['/sign-up', SignUpRoute],
    ])('%s has one title: the server head says what the localized title says in English', async (path, route) => {
      const { default: en } = await import('../../../../../packages/i18n/messages/en.json');
      const { MESSAGE_IDS } = await import('../../../../../packages/i18n/src/message-ids');
      const english = (key: keyof typeof MESSAGE_IDS) => String(en[MESSAGE_IDS[key] as keyof typeof en]);
      const head = (route.options.head as () => { meta: { title?: string }[] })();
      expect(head.meta.find((entry) => entry.title)?.title).toBe(authDocumentTitle(path, english));
    });
  });

  describe('PUBLIC-11: one validation and submit policy', () => {
    it.each(pages)('%s keeps its button enabled and shows localized inline errors instead of the browser bubble', async (_name, Page) => {
      mocks.locale = 'ar';
      await render(Page);
      const form = container.querySelector('form');
      expect(form?.noValidate).toBe(true);
      const send = container.querySelector<HTMLButtonElement>('button[type="submit"]');
      expect(send?.disabled).toBe(false);
      await submit();
      expect(mocks.send).not.toHaveBeenCalled();
      const email = container.querySelector<HTMLInputElement>('#email');
      expect(email?.getAttribute('aria-invalid')).toBe('true');
      const errorId = email?.getAttribute('aria-describedby') ?? '';
      expect(document.getElementById(errorId)?.textContent).toBe('البريد الإلكتروني مطلوب');
      // The first field in error takes focus.
      expect(document.activeElement?.id).toBe(container.querySelector('#name') ? 'name' : 'email');
    });

    it('names the empty name field and fixes the email error as the writer types', async () => {
      await render(signUp);
      await submit();
      expect(document.getElementById(container.querySelector('#name')?.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Enter your name.');
      await enter('#email', 'ada@');
      expect(container.querySelector('#email-error')?.textContent).toBe('Enter a valid email address');
      await enter('#email', 'ada@example.test');
      expect(container.querySelector('#email-error')).toBeNull();
      expect(container.querySelector('#email')?.hasAttribute('aria-invalid')).toBe(false);
    });

    it('shows no error while a fresh field is typed into, only after it is left', async () => {
      await render(signIn);
      await enter('#email', 'ada@');
      expect(container.querySelector('#email-error')).toBeNull();
      await act(async () => container.querySelector<HTMLInputElement>('#email')?.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
      expect(container.querySelector('#email-error')?.textContent).toBe('Enter a valid email address');
    });

    it.each(pages)('%s uses the shared notice for the legal links', async (_name, Page) => {
      await render(Page);
      const styles = new Set([...container.querySelectorAll('a[href="/terms"], a[href="/privacy"]')].map((link) => link.className));
      expect(styles.size).toBe(1);
    });
  });

  describe('PUBLIC-12: the code step', () => {
    it.each(pages)('%s heads the step "Check your email" and puts the address on its own left-to-right line', async (_name, Page) => {
      mocks.locale = 'ar';
      await reachCodeStep(Page);
      expect(container.textContent).toContain('تحقق من بريدك الإلكتروني');
      const address = container.querySelector('[data-slot="code-email"]');
      expect(address?.textContent).toBe('ada.lovelace.with.a.long.address@analytical-engine.example');
      expect(address?.getAttribute('dir')).toBe('ltr');
      expect(address?.className).toContain('[unicode-bidi:isolate]');
      expect(container.querySelector('[data-input-otp]')?.closest('[dir="ltr"]')).not.toBeNull();
    });

    it('links to the webmail inbox only for addresses it recognises', async () => {
      await reachCodeStep(signIn, 'ada@gmail.com');
      const inbox = [...container.querySelectorAll('a')].find((link) => link.textContent === 'Open Gmail');
      expect(inbox?.getAttribute('href')).toBe('https://mail.google.com/mail/u/0/#inbox');
      expect(inbox?.getAttribute('rel')).toBe('noopener noreferrer');
      await act(async () => button('Change email')?.click());
      await enter('#email', 'ada@company.example');
      await submit();
      expect(container.textContent).not.toContain('Open ');
    });

    it.each(pages)('%s clears a wrong code and puts the caret back in the first box', async (_name, Page) => {
      mocks.verify.mockResolvedValue({ error: { status: 400, code: 'INVALID_OTP', message: 'Invalid OTP' } });
      await reachCodeStep(Page);
      await enter('[data-input-otp]', '123456');
      expect(mocks.verify).toHaveBeenCalledOnce();
      const input = container.querySelector<HTMLInputElement>('[data-input-otp]');
      expect(input?.value).toBe('');
      expect(document.activeElement).toBe(input);
      expect(input?.getAttribute('aria-invalid')).toBe('true');
      expect(document.getElementById(input?.getAttribute('aria-describedby')?.split(' ')[0] ?? '')?.textContent).toBe(
        'That code is invalid or expired.',
      );
    });

    it.each(pages)('%s says a locked code needs a new one and makes Resend the main action (403 TOO_MANY_ATTEMPTS)', async (_name, Page) => {
      mocks.verify.mockResolvedValue({ error: { status: 403, code: 'TOO_MANY_ATTEMPTS', message: 'Too many attempts' } });
      await reachCodeStep(Page);
      await enter('[data-input-otp]', '123456');
      expect(container.querySelector('[role="alert"]')?.textContent).toBe('Too many attempts. Request a new code.');
      expect(container.querySelector<HTMLInputElement>('[data-input-otp]')?.disabled).toBe(true);
      expect(container.querySelector('button[type="submit"]')).toBeNull();
      // Its first countdown still runs; once it ends, Resend sends a fresh code and the boxes open again.
      const resend = container.querySelector<HTMLButtonElement>('form button');
      expect(resend?.textContent).toMatch(/^Resend/);
    });

    it('gives the rate limiter’s wait and counts Resend down from it (429 Retry-After)', async () => {
      mocks.locale = 'ar';
      mocks.verify.mockImplementation(async (_body: unknown, fetchOptions: { onError: (context: { response: Response }) => void }) => {
        fetchOptions.onError({ response: new Response(null, { status: 429, headers: { 'Retry-After': '120' } }) });
        return { error: { status: 429, message: 'Too many requests. Please try again later.' } };
      });
      await reachCodeStep(signIn);
      await enter('[data-input-otp]', '123456');
      const wait = new Intl.NumberFormat('ar', { style: 'unit', unit: 'minute', unitDisplay: 'long' }).format(2);
      expect(container.querySelector('[role="alert"]')?.textContent).toBe(`محاولات كثيرة جدًا. الوقت المتبقي قبل المحاولة مجددًا: ${wait}.`);
      expect(container.querySelector('form button')?.textContent).toContain('120');
    });

    it('asks for the missing digits instead of sending a short code', async () => {
      await reachCodeStep(signIn);
      await enter('[data-input-otp]', '123');
      await submit();
      expect(mocks.verify).not.toHaveBeenCalled();
      expect(container.querySelector('[role="alert"]')?.textContent).toBe('Enter the valid 6-digit code from your email.');
    });
  });

  describe('PUBLIC-19: right-to-left inputs', () => {
    it('keeps the email left-to-right and localizes the name example', async () => {
      mocks.locale = 'ar';
      await render(signUp);
      expect(container.querySelector('#email')?.getAttribute('dir')).toBe('ltr');
      expect(container.querySelector('#email')?.className).toContain('text-start');
      expect(container.querySelector('#name')?.getAttribute('placeholder')).toBe('ليلى أحمد');
    });
  });
});

describe('PUBLIC-13: the way back to the marketing site', () => {
  it('links the logo and a mirrored "Back to Nibleaf" to the home page', async () => {
    const { AuthLayout } = await import('@/layouts/auth');
    mocks.locale = 'ar';
    const html = document.createElement('div');
    html.innerHTML = renderToString(<AuthLayout subtitle="x">form</AuthLayout>);
    const back = html.querySelector('[data-slot="auth-back-home"]');
    expect(back?.getAttribute('href')).toBe('/');
    expect(back?.textContent).toBe('العودة إلى Nibleaf');
    expect(back?.querySelector('svg')?.getAttribute('class')).toContain('rtl:-scale-x-100');
    const logos = [...html.querySelectorAll('a[href="/"]')].filter((link) => link.textContent === 'Nibleaf');
    // The brand panel's logo (wide screens) and the form's logo (narrow screens).
    expect(logos).toHaveLength(2);
  });
});
