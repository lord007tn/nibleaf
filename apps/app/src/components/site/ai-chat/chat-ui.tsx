import { Button } from '@nibleaf/design-system/components/ui/button';
import { siteChatT } from '@nibleaf/i18n/site-chat';
import { useRouter } from '@tanstack/react-router';
import { Sparkles } from 'lucide-react';
import { lazy, type Ref, Suspense, useEffect, useRef, useState } from 'react';
import { analyticsDeliveryMode, analyticsScripts } from '@/lib/site-seo';
import type { ChatRequest, ChatRootOptions, OpenChat } from './provider';

/*
 * The chat as readers meet it: launcher, end-of-article card and the panel's
 * state. The reader layout loads this module after the page, with the chat's
 * strings, so none of it weighs on the public docs bundle. The panel loads from
 * here too: its preload list (every chunk it depends on) then sits in this
 * chunk, not the eager one.
 */

const Panel = lazy(() => import('./panel'));

/** Opens the panel for each new request, follows the `?ask=` deep link, and
 * returns focus to where the reader was when the panel closes. */
export function ChatRoot({ request, openChat, ask, ...options }: ChatRootOptions & { request?: ChatRequest; openChat: OpenChat }) {
  const [open, setOpen] = useState(false);
  // A new request reopens the panel; closing it keeps the conversation.
  const [shown, setShown] = useState<number>();
  if (request && request.id !== shown) {
    setShown(request.id);
    setOpen(true);
  }
  const launcher = useRef<HTMLButtonElement | null>(null);
  const consumed = useRef<string | undefined>(undefined);
  const requiresConsent = analyticsDeliveryMode(options.config) === 'consent' && analyticsScripts(options.config).length > 0;
  const router = useRouter();
  useEffect(() => {
    if (!ask) {
      consumed.current = undefined;
      return;
    }
    if (consumed.current === ask) return;
    consumed.current = ask;
    openChat({ question: ask, source: 'deep_link' });
    // Drop only `ask` from the address the reader is on. A search-only navigate
    // from the reader layout route would resolve to the site root.
    const url = new URL(window.location.href);
    url.searchParams.delete('ask');
    router.history.replace(`${url.pathname}${url.search}${url.hash}`);
  }, [ask, openChat, router]);
  return (
    <>
      <Launcher ref={launcher} lang={options.lang} consentBanner={requiresConsent} onOpen={() => openChat({ source: 'launcher' })} />
      {request && (
        <Suspense fallback={null}>
          <Panel
            {...options}
            open={open}
            onOpenChange={(value) => {
              setOpen(value);
              if (!value) {
                requestAnimationFrame(() => {
                  const target = request.trigger;
                  // A deep link opens from no control at all (focus is on <body>).
                  if (target && target !== document.body && target.isConnected && target.getClientRects().length) target.focus();
                  else launcher.current?.focus();
                });
              }
            }}
            request={request}
            requiresConsent={requiresConsent}
          />
        </Suspense>
      )}
    </>
  );
}

/** The floating "Ask AI" button. It steps aside while the analytics consent
 * banner holds the same corner. */
function Launcher({
  lang,
  consentBanner,
  onOpen,
  ref,
}: {
  lang?: string;
  /** The site asks readers for analytics consent, so its banner may show. */
  consentBanner: boolean;
  onOpen: () => void;
  ref: Ref<HTMLButtonElement>;
}) {
  const t = siteChatT(lang);
  const bannerTitle = t('analyticsConsentTitle');
  const [bannerVisible, setBannerVisible] = useState(consentBanner);
  useEffect(() => {
    if (!consentBanner) return;
    const update = () => setBannerVisible(Boolean(document.querySelector(`section[aria-label="${CSS.escape(bannerTitle)}"]`)));
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    update();
    return () => observer.disconnect();
  }, [consentBanner, bannerTitle]);
  if (consentBanner && bannerVisible) return null;
  return (
    <Button ref={ref} className="fixed end-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 rounded-full shadow-lg" onClick={onOpen}>
      <Sparkles aria-hidden className="size-4" />
      {t('aiTitle')}
    </Button>
  );
}

/** End-of-article prompt: where readers finish or get stuck. Uses the theme's
 * AI surface so it follows every documentation theme, mode and direction. */
export function PageAction({ lang, onOpen }: { lang?: string; onOpen: () => void }) {
  const t = siteChatT(lang);
  return (
    <aside
      data-theme-surface="ai"
      aria-label={t('aiPage')}
      className="not-prose my-10 flex flex-col gap-4 rounded-2xl border p-5 shadow-sm sm:flex-row sm:items-center"
    >
      <span aria-hidden className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-base">{t('aiPageTitle')}</p>
        <p className="mt-1 text-muted-foreground text-sm">{t('aiPageBody')}</p>
      </div>
      <Button className="w-full shrink-0 sm:w-auto" onClick={onOpen}>
        <Sparkles aria-hidden className="size-4" />
        {t('aiPage')}
      </Button>
    </aside>
  );
}
