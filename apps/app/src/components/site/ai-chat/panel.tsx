import { Button } from '@nibleaf/design-system/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@nibleaf/design-system/components/ui/sheet';
import { siteT } from '@nibleaf/i18n/site';
import {
  type AiChatErrorCode,
  type AiChatFinalEvent,
  aiChatErrorEventSchema,
  aiChatFinalEventSchema,
  aiChatStatusEventSchema,
  siteChatBody,
} from '@nibleaf/validators';
import { useChat } from '@tanstack/ai-react';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { chatSiteFn } from '@/functions/site-chat';
import { Composer } from './composer';
import { buildHistory, deriveConsent, errorKey } from './helpers';
import { ChatMessage } from './message';
import type { ChatOptions, PageContext } from './provider';
import { useChatViewport } from './use-chat-viewport';

export default function Panel(
  options: ChatOptions & {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    request?: { id: number; question?: string; page?: PageContext };
    requiresConsent: boolean;
  },
) {
  const t = siteT(options.lang);
  const viewport = useChatViewport(options.open);
  const [conversationId, setConversationId] = useState(() => crypto.randomUUID());
  const [finals, setFinals] = useState<Record<string, AiChatFinalEvent>>({});
  const [phase, setPhase] = useState<'searching' | 'writing' | 'checking'>('searching');
  const [code, setCode] = useState<AiChatErrorCode | 'offline'>();
  const [announcement, setAnnouncement] = useState('');
  const [page, setPage] = useState<PageContext>();
  const [lastQuestion, setLastQuestion] = useState('');
  const questions = useRef<Record<string, string>>({});
  const pendingQuestion = useRef('');
  const lastRequest = useRef<number | undefined>(undefined);
  const end = useRef<HTMLDivElement>(null);
  const consent = () => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(`nibleaf.analytics.consent.${options.projectId}`);
    } catch {
      // Storage may be blocked; keep consent unknown and the session ephemeral.
    }
    return deriveConsent(options.requiresConsent, stored);
  };
  const chat = useChat({
    threadId: conversationId,
    fetcher: ({ data }, { signal }) => chatSiteFn({ data: { projectId: options.projectId, ...siteChatBody.parse(data) }, signal }),
    onCustomEvent: (name, value) => {
      if (name === 'nibleaf.chat.status') {
        const result = aiChatStatusEventSchema.safeParse(value);
        if (result.success) setPhase(result.data.phase);
      }
      if (name === 'nibleaf.chat.error') {
        const result = aiChatErrorEventSchema.safeParse(value);
        if (result.success) {
          setCode(result.data.code);
          setAnnouncement(t(errorKey(result.data.code)));
        }
      }
      if (name === 'nibleaf.chat.final') {
        const result = aiChatFinalEventSchema.safeParse(value);
        if (result.success && result.data.conversationId === conversationId) {
          questions.current[result.data.turnId] = pendingQuestion.current;
          setFinals((previous) => ({ ...previous, [result.data.turnId]: result.data }));
          setAnnouncement(t(result.data.status === 'answered' ? 'aiReady' : 'aiNoAnswer'));
        }
      }
    },
  });
  const send = (question: string, context: PageContext | null = page ?? null) => {
    if (chat.isLoading) return;
    setLastQuestion(question);
    setCode(undefined);
    setAnnouncement('');
    setPhase('searching');
    if (!navigator.onLine) {
      setCode('offline');
      setAnnouncement(t('aiOffline'));
      return;
    }
    pendingQuestion.current = question;
    let sessionId: string | undefined;
    try {
      sessionId = sessionStorage.getItem('nibleaf.chat.session') ?? crypto.randomUUID();
      sessionStorage.setItem('nibleaf.chat.session', sessionId);
    } catch {
      // Storage may be blocked; keep consent unknown and the session ephemeral.
    }
    void chat.sendMessage(question, {
      body: {
        conversationId,
        question,
        history: buildHistory(Object.values(finals).map((final) => ({ question: questions.current[final.turnId] ?? '', final }))),
        lang: options.lang,
        version: options.version,
        pagePath: context?.path,
        consent: consent(),
        sessionId,
      },
    });
  };
  const sendRequest = useEffectEvent(send);
  useEffect(() => {
    const request = options.request;
    if (!request || request.id === lastRequest.current || (request.question && chat.isLoading)) return;
    lastRequest.current = request.id;
    setPage(request.page);
    if (request.question) sendRequest(request.question, request.page ?? null);
  }, [options.request, chat.isLoading]);
  useEffect(() => {
    if (chat.error && !code) {
      setCode(navigator.onLine ? 'failed' : 'offline');
      setAnnouncement(t(navigator.onLine ? 'aiFailed' : 'aiOffline'));
    }
  }, [chat.error, code, t]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when message content or final sources change.
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [chat.messages, finals]);
  const reset = () => {
    chat.stop();
    chat.clear();
    setFinals({});
    questions.current = {};
    setCode(undefined);
    setAnnouncement('');
    setConversationId(crypto.randomUUID());
  };
  const starters = page
    ? [t('aiSummary'), t('aiSteps')]
    : [...(options.lang === options.defaultLanguage ? (options.config?.search?.aiStarterQuestions ?? []) : []), t('aiStart'), t('aiFind')].slice(
        0,
        4,
      );
  return (
    <Sheet open={options.open} onOpenChange={options.onOpenChange}>
      <SheetContent
        side={options.direction === 'rtl' ? 'left' : 'right'}
        style={viewport}
        showCloseButton={false}
        dir={options.direction}
        data-theme-surface="ai"
        className="h-[var(--chat-height,100dvh)]! top-[var(--chat-top,0px)]! bottom-auto! w-full! max-w-none! gap-0 overflow-hidden pt-[env(safe-area-inset-top)] motion-reduce:transition-none md:w-[440px]! md:max-w-[460px]!"
      >
        <header className="flex shrink-0 items-start gap-2 border-b p-4">
          <div className="min-w-0 flex-1">
            <SheetTitle>{t('aiTitle')}</SheetTitle>
            <SheetDescription>{t('aiSubtitle')}</SheetDescription>
          </div>
          <Button variant="ghost" size="sm" onClick={reset}>
            {t('aiNew')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => options.onOpenChange(false)}>
            {t('aiClose')}
          </Button>
        </header>
        {page && (
          <div className="flex items-center gap-2 border-b px-4 py-2">
            <span className="min-w-0 flex-1 truncate">
              {t('aiAbout')} {page.title}
            </span>
            <Button size="sm" variant="ghost" onClick={() => setPage(undefined)}>
              {t('aiRemove')}
            </Button>
          </div>
        )}
        <div role="log" aria-live="off" aria-label={t('aiTitle')} className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
          {chat.messages.length === 0 && (
            <div className="space-y-3 py-6">
              <p>{t('aiIntro')}</p>
              {starters.map((question) => (
                <Button key={question} variant="outline" className="w-full justify-start text-start" onClick={() => send(question)}>
                  {question}
                </Button>
              ))}
            </div>
          )}
          {chat.messages.map((message) => {
            const text = message.parts
              .filter((part) => part.type === 'text')
              .map((part) => part.content)
              .join('');
            return message.role === 'user' ? (
              <div key={message.id} className="ms-8 whitespace-pre-wrap rounded-xl bg-primary/10 p-3">
                {text}
              </div>
            ) : (
              <ChatMessage
                key={message.id}
                text={text}
                final={finals[message.id]}
                options={options}
                busy={chat.isLoading && !finals[message.id]}
                consent={consent()}
                close={() => options.onOpenChange(false)}
              />
            );
          })}
          {chat.isLoading && (
            <p aria-hidden className="text-muted-foreground text-sm">
              {t(phase === 'searching' ? 'aiSearching' : phase === 'writing' ? 'aiWriting' : 'aiChecking')}
            </p>
          )}
          {code && (
            <div className="space-y-2 rounded-lg bg-muted p-3">
              <p>{t(errorKey(code))}</p>
              {code === 'conversation_limit' ? (
                <Button onClick={reset}>{t('aiNew')}</Button>
              ) : (
                !['quota_exhausted', 'budget_exhausted'].includes(code) && (
                  <Button disabled={chat.isLoading} onClick={() => send(lastQuestion)}>
                    {t('aiRetry')}
                  </Button>
                )
              )}
            </div>
          )}
          <div ref={end} />
        </div>
        <div aria-live="polite" className="sr-only">
          {announcement}
        </div>
        <footer className="shrink-0 space-y-2 border-t px-4 pt-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          <Composer lang={options.lang} busy={chat.isLoading} send={send} stop={chat.stop} />
          <p className="text-muted-foreground text-xs">{t('aiCaution')}</p>
          {options.config?.search?.aiConversationCapture !== false && <p className="text-muted-foreground text-xs">{t('aiPrivacy')}</p>}
        </footer>
      </SheetContent>
    </Sheet>
  );
}
