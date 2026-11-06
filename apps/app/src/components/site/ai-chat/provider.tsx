import { Button } from '@nibleaf/design-system/components/ui/button';
import { siteT } from '@nibleaf/i18n/site';
import type { AiChatOpenSource } from '@nibleaf/validators';
import { Sparkles } from 'lucide-react';
import { type ComponentProps, createContext, lazy, type ReactNode, Suspense, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { DocumentationReaderLayout } from '@/components/site/documentation-theme-provider';
import type { ProjectConfig } from '@/hooks/api/types';
import { analyticsDeliveryMode, analyticsScripts } from '@/lib/site-seo';

const Panel = lazy(() => import('./panel'));
export type PageContext = { title: string; path: string };
/** Where the reader opened the chat from, for the `chat_opened` event. */
export type ChatOpenRequest = { question?: string; page?: PageContext; source: AiChatOpenSource };
type ChatContext = { openChat: (request: ChatOpenRequest) => void };
const Context = createContext<ChatContext | null>(null);
const useSiteChat = () => useContext(Context);
export type ChatOptions = {
  projectId: string;
  lang?: string;
  version?: string;
  defaultLanguage?: string;
  direction: 'ltr' | 'rtl';
  config: ProjectConfig | null;
};
export function SiteChatProvider({
  children,
  available,
  ask,
  onAskConsumed,
  ...options
}: ChatOptions & { children: ReactNode; available: boolean; ask?: string; onAskConsumed: () => void }) {
  const [open, setOpen] = useState(false);
  const [activated, setActivated] = useState(false);
  const [request, setRequest] = useState<ChatOpenRequest & { id: number }>();
  const trigger = useRef<HTMLElement | null>(null);
  const launcher = useRef<HTMLButtonElement | null>(null);
  const consumed = useRef<string | undefined>(undefined);
  const t = siteT(options.lang);
  const required = analyticsDeliveryMode(options.config) === 'consent' && analyticsScripts(options.config).length > 0;
  const [bannerVisible, setBannerVisible] = useState(required);
  useEffect(() => {
    if (!required) {
      setBannerVisible(false);
      return;
    }
    const update = () => setBannerVisible(Boolean(document.querySelector(`section[aria-label="${CSS.escape(t('analyticsConsentTitle'))}"]`)));
    const observer = new MutationObserver(update);
    observer.observe(document.body, { childList: true, subtree: true });
    update();
    return () => observer.disconnect();
  }, [required, t]);
  const openChat = useCallback((next: ChatOpenRequest) => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRequest({ ...next, id: Date.now() });
    setActivated(true);
    setOpen(true);
  }, []);
  useEffect(() => {
    if (!ask) {
      consumed.current = undefined;
      return;
    }
    if (!available || consumed.current === ask) return;
    consumed.current = ask;
    openChat({ question: ask, source: 'deep_link' });
    onAskConsumed();
  }, [ask, available, onAskConsumed, openChat]);
  return (
    <Context.Provider value={available ? { openChat } : null}>
      {children}
      {available && (
        <>
          {!bannerVisible && (
            <Button
              ref={launcher}
              className="fixed end-4 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 rounded-full shadow-lg"
              onClick={() => openChat({ source: 'launcher' })}
            >
              <Sparkles aria-hidden className="size-4" />
              {t('aiTitle')}
            </Button>
          )}
          {activated && (
            <Suspense fallback={null}>
              <Panel
                {...options}
                open={open}
                onOpenChange={(value) => {
                  setOpen(value);
                  if (!value) {
                    requestAnimationFrame(() => {
                      const target = trigger.current;
                      if (target?.isConnected && target.getClientRects().length) target.focus();
                      else launcher.current?.focus();
                    });
                  }
                }}
                request={request}
                requiresConsent={required}
              />
            </Suspense>
          )}
        </>
      )}
    </Context.Provider>
  );
}
/** End-of-article prompt: where readers finish or get stuck. Uses the theme's
 * AI surface so it follows every documentation theme, mode and direction. */
export function SiteChatPageAction({ title, path, lang }: PageContext & { lang?: string }) {
  const chat = useSiteChat();
  if (!chat) return null;
  const t = siteT(lang);
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
      <Button className="w-full shrink-0 sm:w-auto" onClick={() => chat.openChat({ page: { title, path }, source: 'page_button' })}>
        <Sparkles aria-hidden className="size-4" />
        {t('aiPage')}
      </Button>
    </aside>
  );
}
export function ChatSearchBridge({ children }: { children: (onAskAi?: (question: string) => void) => ReactNode }) {
  const chat = useSiteChat();
  return children(chat ? (question) => chat.openChat({ question, source: 'search_handoff' }) : undefined);
}

export function SiteChatReaderLayout({
  chat,
  ...layout
}: ComponentProps<typeof DocumentationReaderLayout> & { chat: Omit<ComponentProps<typeof SiteChatProvider>, 'children'> }) {
  return (
    <SiteChatProvider key={chat.projectId} {...chat}>
      <DocumentationReaderLayout {...layout} />
    </SiteChatProvider>
  );
}
