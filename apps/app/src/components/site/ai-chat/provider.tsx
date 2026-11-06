import { Button } from '@nibleaf/design-system/components/ui/button';
import { siteT } from '@nibleaf/i18n/site';
import { Sparkles } from 'lucide-react';
import { type ComponentProps, createContext, lazy, type ReactNode, Suspense, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { DocumentationReaderLayout } from '@/components/site/documentation-theme-provider';
import type { ProjectConfig } from '@/hooks/api/types';
import { analyticsDeliveryMode, analyticsScripts } from '@/lib/site-seo';

const Panel = lazy(() => import('./panel'));
export type PageContext = { title: string; path: string };
type ChatContext = { openChat: (question?: string, page?: PageContext) => void };
const Context = createContext<ChatContext | null>(null);
export const useSiteChat = () => useContext(Context);
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
  const [request, setRequest] = useState<{ id: number; question?: string; page?: PageContext }>();
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
  const openChat = useCallback((question?: string, page?: PageContext) => {
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRequest({ id: Date.now(), question, page });
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
    openChat(ask);
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
              onClick={() => openChat()}
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
export function SiteChatPageAction({ title, path, lang }: PageContext & { lang?: string }) {
  const chat = useSiteChat();
  return chat ? (
    <Button variant="ghost" size="sm" onClick={() => chat.openChat(undefined, { title, path })}>
      {siteT(lang)('aiPage')}
    </Button>
  ) : null;
}
export function ChatSearchBridge({ children }: { children: (onAskAi?: (question: string) => void) => ReactNode }) {
  const chat = useSiteChat();
  return children(chat ? (question) => chat.openChat(question) : undefined);
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
