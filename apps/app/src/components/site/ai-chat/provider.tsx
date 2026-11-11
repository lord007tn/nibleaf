import { analyticsConsentPolicy } from '@nibleaf/shared/analytics-consent';
import type { AiChatOpenSource } from '@nibleaf/validators';
import { type ComponentProps, createContext, type ReactNode, Suspense, useContext, useState } from 'react';
import { DocumentationReaderLayout } from '@/components/site/documentation-theme-provider';
import type { ProjectConfig } from '@/hooks/api/types';
import { HydrationIsland, hydrationModule } from '@/lib/hydration-modules';

// The chat's launcher, panel, state and strings load on demand from one module,
// so the public docs bundle carries only this context (see load-chat-ui.ts).
// Hydrating keeps their server markup until it loads, then swaps in the same
// markup, live (see lib/hydration-modules.tsx). It isn't loaded before
// hydrating, as the article is: nothing here is reading content, and the
// router importing it would re-split the chunks the chat shares with the
// reader. It loads when a reader reaches for the launcher or the card (a click
// before then is replayed), or at once for a request (search's hand-off, the
// `?ask=` link) and on sites that ask for analytics consent, whose launcher
// isn't in the server markup until the banner is gone. If it can't load, the
// markup goes after the retries: a launcher without its code does nothing.
const siteChatUiModule = hydrationModule('site-chat-ui', () => import('./load-chat-ui').then((loader) => loader.loadChatUi()));
const CHAT_MODULES = [siteChatUiModule];
function ChatRoot(props: ComponentProps<typeof import('./chat-ui').ChatRoot>) {
  const waitForReader = !props.request && !props.ask && analyticsConsentPolicy(props.config) === 'not_required';
  return (
    <HydrationIsland className="contents" keepServerHtmlOnFailure={false} loadOnIntent={waitForReader} modules={CHAT_MODULES}>
      {() => {
        const ui = siteChatUiModule.read();
        return <ui.ChatRoot {...props} />;
      }}
    </HydrationIsland>
  );
}
function PageAction(props: ComponentProps<typeof import('./chat-ui').PageAction>) {
  return (
    <HydrationIsland className="contents" keepServerHtmlOnFailure={false} loadOnIntent modules={CHAT_MODULES}>
      {() => {
        const ui = siteChatUiModule.read();
        return <ui.PageAction {...props} />;
      }}
    </HydrationIsland>
  );
}

export type PageContext = { title: string; path: string };
/** Where the reader opened the chat from, for the `chat_opened` event. */
export type ChatOpenRequest = { question?: string; page?: PageContext; source: AiChatOpenSource };
/** An open request as the chat receives it: `id` tells repeats apart, and
 * `trigger` is where focus returns when the panel closes. */
export type ChatRequest = ChatOpenRequest & { id: number; trigger: HTMLElement | null };
export type OpenChat = (request: ChatOpenRequest) => void;
const Context = createContext<OpenChat | null>(null);
export type ChatOptions = {
  projectId: string;
  lang?: string;
  version?: string;
  defaultLanguage?: string;
  direction: 'ltr' | 'rtl';
  config: ProjectConfig | null;
  /** How many days the server keeps question text for this site; null or
   * missing when it keeps none (the site's setting is off, or the instance can't
   * encrypt it). From the site shell, so the chat never claims storage that isn't there. */
  questionRetentionDays?: number | null;
};
/** The reader layout's chat settings, plus its `?ask=` deep link. */
export type ChatRootOptions = ChatOptions & { ask?: string };

export function SiteChatProvider({ children, available, ...chat }: ChatRootOptions & { children: ReactNode; available: boolean }) {
  // The latest request. One made before the chat has loaded waits here for it.
  const [request, setRequest] = useState<ChatRequest>();
  const openChat: OpenChat = (next) =>
    setRequest({ ...next, id: Date.now(), trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null });
  return (
    <Context.Provider value={available ? openChat : null}>
      {children}
      {available && (
        <Suspense fallback={null}>
          <ChatRoot {...chat} request={request} openChat={openChat} />
        </Suspense>
      )}
    </Context.Provider>
  );
}
/** The "Ask AI about this page" card at the end of an article. */
export function SiteChatPageAction({ title, path, lang }: PageContext & { lang?: string }) {
  const openChat = useContext(Context);
  if (!openChat) return null;
  return (
    <Suspense fallback={null}>
      <PageAction lang={lang} onOpen={() => openChat({ page: { title, path }, source: 'page_button' })} />
    </Suspense>
  );
}
export function ChatSearchBridge({ children }: { children: (onAskAi?: (question: string) => void) => ReactNode }) {
  const openChat = useContext(Context);
  return children(openChat ? (question) => openChat({ question, source: 'search_handoff' }) : undefined);
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
