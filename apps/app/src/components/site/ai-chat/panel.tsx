import { Button } from '@nibleaf/design-system/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@nibleaf/design-system/components/ui/sheet';
import { siteChatT } from '@nibleaf/i18n/site-chat';
import { analyticsConsentPolicy } from '@nibleaf/shared/analytics-consent';
import {
  AI_CHAT_EVENT,
  type AiChatClientEvent,
  type AiChatErrorCode,
  type AiChatFinalEvent,
  aiChatErrorEventSchema,
  aiChatFinalEventSchema,
  aiChatFollowUpsEventSchema,
  aiChatStatusEventSchema,
  siteChatBody,
} from '@nibleaf/validators';
import { useChat } from '@tanstack/ai-react';
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { chatSiteFn } from '@/functions/site-chat';
import { readSiteConsent } from '@/lib/site-consent';
import { api } from '@/services/api';
import { Composer } from './composer';
import { createChatEventQueue } from './events';
import { buildHistory, deriveConsent, errorKey, questionRetention } from './helpers';
import { ChatMessage, type TurnScope } from './message';
import type { ChatOpenRequest, ChatOptions, PageContext } from './provider';
import { readerSession } from './session';
import { useChatViewport } from './use-chat-viewport';

function Typing({ label, phase }: { label: string; phase: string }) {
  return (
    <div role="status" aria-label={label} className="flex items-center gap-3 rounded-xl border p-4 text-muted-foreground text-sm">
      <span aria-hidden className="flex gap-1">
        {[0, 1, 2].map((dot) => (
          <span
            key={dot}
            className="size-1.5 animate-bounce rounded-full bg-current motion-reduce:animate-none"
            style={{ animationDelay: `${dot * 150}ms` }}
          />
        ))}
      </span>
      <span aria-hidden>{phase}</span>
    </div>
  );
}

export default function Panel(
  options: ChatOptions & {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    request?: ChatOpenRequest & { id: number };
    requiresConsent: boolean;
  },
) {
  const t = siteChatT(options.lang);
  const viewport = useChatViewport(options.open);
  const [conversationId, setConversationId] = useState(() => crypto.randomUUID());
  const [finals, setFinals] = useState<Record<string, AiChatFinalEvent>>({});
  const [followUps, setFollowUps] = useState<Record<string, string[]>>({});
  const [phase, setPhase] = useState<'searching' | 'writing' | 'checking'>('searching');
  const [code, setCode] = useState<AiChatErrorCode | 'offline'>();
  const [announcement, setAnnouncement] = useState('');
  const [page, setPage] = useState<PageContext>();
  const [lastQuestion, setLastQuestion] = useState('');
  // Questions the reader stopped before a checked answer arrived (user message ids).
  const [stopped, setStopped] = useState<string[]>([]);
  const questions = useRef<Record<string, string>>({});
  // The version each question was asked in, and each answered turn's scope, so its
  // links keep pointing at what it cited after the reader switches language or version.
  const askedVersion = useRef<string | undefined>(undefined);
  const turnScopes = useRef<Record<string, TurnScope>>({});
  const pendingQuestion = useRef('');
  const lastRequest = useRef<number | undefined>(undefined);
  const end = useRef<HTMLDivElement>(null);
  const consent = () =>
    analyticsConsentPolicy(options.config) === 'blocked'
      ? ('denied' as const)
      : deriveConsent(options.requiresConsent, readSiteConsent(options.projectId));
  // Content-free interaction events, batched and flushed when the reader leaves.
  const events = useMemo(
    () =>
      createChatEventQueue((body) =>
        api.public.sites[':id'].chat.events.$post({ param: { id: options.projectId }, json: body }, { init: { keepalive: true } }),
      ),
    [options.projectId],
  );
  const track = (event: AiChatClientEvent) => {
    const consentState = consent();
    const sessionId = readerSession(options.projectId, consentState);
    events.track(event, { consent: consentState, ...(sessionId ? { sessionId } : {}), ...(options.lang ? { lang: options.lang } : {}) });
  };
  useEffect(() => () => events.flush(), [events]);
  useEffect(() => {
    if (!options.open) events.flush();
  }, [options.open, events]);
  const chat = useChat({
    threadId: conversationId,
    fetcher: ({ data }, { signal }) => chatSiteFn({ data: { projectId: options.projectId, ...siteChatBody.parse(data) }, signal }),
    onCustomEvent: (name, value) => {
      if (name === AI_CHAT_EVENT.status) {
        const result = aiChatStatusEventSchema.safeParse(value);
        if (result.success) setPhase(result.data.phase);
      }
      if (name === AI_CHAT_EVENT.error) {
        const result = aiChatErrorEventSchema.safeParse(value);
        if (result.success) {
          setCode(result.data.code);
          setAnnouncement(t(errorKey(result.data.code)));
        }
      }
      if (name === AI_CHAT_EVENT.final) {
        const result = aiChatFinalEventSchema.safeParse(value);
        if (result.success && result.data.conversationId === conversationId) {
          questions.current[result.data.turnId] = pendingQuestion.current;
          turnScopes.current[result.data.turnId] = { lang: result.data.language, version: askedVersion.current };
          setFinals((previous) => ({ ...previous, [result.data.turnId]: result.data }));
          setAnnouncement(t(result.data.status === 'answered' ? 'aiReady' : 'aiNoAnswer'));
        }
      }
      if (name === AI_CHAT_EVENT.followUps) {
        const result = aiChatFollowUpsEventSchema.safeParse(value);
        if (result.success) {
          setFollowUps((previous) => ({ ...previous, [result.data.turnId]: result.data.questions }));
          // They arrive after the answer: tell screen readers they are there.
          if (result.data.questions.length) setAnnouncement(t('aiSuggestionsAdded'));
        }
      }
    },
  });
  // The checked answer ends the wait: a run still bringing its suggestions is not
  // answering, so the reader can read, stop nothing, and ask the next question.
  const latest = chat.messages.at(-1);
  const answering = chat.isLoading && !(latest && latest.role !== 'user' && finals[latest.id]);
  // Follow new content only while the reader is at the bottom: someone who
  // scrolled up to read is never pulled away by later text or suggestions.
  const pinned = useRef(true);
  const send = (question: string, context: PageContext | null = page ?? null) => {
    if (answering) return;
    pinned.current = true;
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
    askedVersion.current = options.version;
    const consentState = consent();
    const sessionId = readerSession(options.projectId, consentState);
    void chat.sendMessage(question, {
      body: {
        conversationId,
        question,
        history: buildHistory(Object.values(finals).map((final) => ({ question: questions.current[final.turnId] ?? '', final }))),
        lang: options.lang,
        version: options.version,
        pagePath: context?.path,
        consent: consentState,
        sessionId,
      },
      // Suggestions still loading for the last answer give way to the new question.
      ...(chat.isLoading ? { whenBusy: 'interrupt' as const } : {}),
    });
  };
  const sendRequest = useEffectEvent(send);
  const trackOpen = useEffectEvent((source: ChatOpenRequest['source']) => track({ name: 'chat_opened', source, conversationId }));
  useEffect(() => {
    const request = options.request;
    // A deep link only fills the field, so it may arrive mid-answer; a send waits.
    if (!request || request.id === lastRequest.current || (request.question && answering && request.source !== 'deep_link')) return;
    // A send issued in the panel's first commit (deep link, search hand-off) is
    // cancelled while the chat client finishes attaching. Wait one task, and
    // only mark the request consumed once it is actually sent.
    const timer = window.setTimeout(() => {
      lastRequest.current = request.id;
      trackOpen(request.source);
      setPage(request.page);
      if (!request.question) return;
      // A shared `?ask=` link only fills the field: the reader reads the
      // question and sends it themselves, so a crafted link (or a crawler)
      // can neither speak for them nor spend the site's AI budget.
      if (request.source === 'deep_link') prefillRequest(request.question);
      else sendRequest(request.question, request.page ?? null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [options.request, answering]);

  useEffect(() => {
    if (chat.error && !code) {
      setCode(navigator.onLine ? 'failed' : 'offline');
      setAnnouncement(t(navigator.onLine ? 'aiFailed' : 'aiOffline'));
    }
  }, [chat.error, code, t]);
  // Reopening the panel shows the latest exchange again, once its content is back.
  useEffect(() => {
    if (!options.open) return;
    pinned.current = true;
    const timer = window.setTimeout(() => end.current?.scrollIntoView({ block: 'nearest' }), 0);
    return () => window.clearTimeout(timer);
  }, [options.open]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when message content, sources or suggestions change.
  useEffect(() => {
    if (pinned.current) end.current?.scrollIntoView({ block: 'nearest' });
  }, [chat.messages, finals, followUps]);
  const stop = () => {
    const asked = chat.messages.findLast((message) => message.role === 'user');
    if (asked) setStopped((ids) => [...ids, asked.id]);
    chat.stop();
    setAnnouncement(t('aiStopped'));
    track({ name: 'stop', conversationId });
  };
  /** Ask a question again. When it is the last exchange and never got a checked
   * answer (stopped or failed), that exchange is replaced rather than repeated. */
  const askAgain = (question: string) => {
    if (answering || !question) return;
    const lastUser = chat.messages.findLastIndex((message) => message.role === 'user');
    const asked = chat.messages[lastUser];
    const reply = chat.messages[lastUser + 1];
    if (asked && textOf(asked) === question && !(reply && finals[reply.id])) chat.setMessages(chat.messages.slice(0, lastUser));
    send(question);
  };
  const reset = () => {
    if (chat.messages.length) track({ name: 'new_chat', conversationId });
    chat.stop();
    chat.clear();
    setFinals({});
    setFollowUps({});
    setStopped([]);
    questions.current = {};
    turnScopes.current = {};
    setCode(undefined);
    setAnnouncement('');
    setConversationId(crypto.randomUUID());
  };
  // What the reader is typing: kept here, so closing the panel does not lose it.
  const [typed, setTyped] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  // The refused question goes to the new chat's field, to edit before sending:
  // the new chat starts without the earlier conversation it may refer to.
  const askInNewChat = (question: string) => {
    reset();
    if (!question) return;
    setTyped(question);
    field.current?.focus();
  };
  const prefillRequest = useEffectEvent((question: string) => {
    setTyped(question);
    // On a phone, focusing would open the keyboard over the question before
    // the reader has read it; they tap the field (or Send) when ready. Same
    // rule as the sheet's initial focus below.
    if (!window.matchMedia('(pointer: coarse), (max-width: 767px)').matches) field.current?.focus();
  });
  const starters = page
    ? [t('aiSummary'), t('aiSteps')]
    : [...(options.lang === options.defaultLanguage ? (options.config?.search?.aiStarterQuestions ?? []) : []), t('aiStart'), t('aiFind')].slice(
        0,
        4,
      );
  const phaseLabel = t(phase === 'searching' ? 'aiSearching' : phase === 'writing' ? 'aiWriting' : 'aiChecking');
  const textOf = (message: (typeof chat.messages)[number]) =>
    message.parts
      .filter((part) => part.type === 'text')
      .map((part) => part.content)
      .join('');
  const last = chat.messages.at(-1);
  const streaming = Boolean(last && last.role !== 'user' && textOf(last));
  const retainedDays = questionRetention(options.questionRetentionDays ?? null, consent());
  const latestAnswer = [...chat.messages].reverse().find((message) => message.role !== 'user' && finals[message.id]?.status === 'answered');
  return (
    <Sheet open={options.open} onOpenChange={options.onOpenChange}>
      <SheetContent
        side={options.direction === 'rtl' ? 'left' : 'right'}
        style={viewport}
        showCloseButton={false}
        // Desktop readers can type straight away; on touch screens focus the
        // dialog itself so the keyboard does not cover the answer.
        initialFocus={(type) =>
          type === 'touch' || window.matchMedia('(max-width: 767px)').matches
            ? true
            : (document.querySelector<HTMLTextAreaElement>('[data-theme-surface="ai"] textarea') ?? true)
        }
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
              {t('aiAbout')} <bdi>{page.title}</bdi>
            </span>
            <Button size="sm" variant="ghost" onClick={() => setPage(undefined)}>
              {t('aiRemove')}
            </Button>
          </div>
        )}
        <div
          role="log"
          aria-live="off"
          aria-label={t('aiTitle')}
          className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4"
          onScroll={(event) => {
            const log = event.currentTarget;
            pinned.current = log.scrollHeight - log.scrollTop - log.clientHeight < 96;
          }}
        >
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
          {chat.messages.map((message, index) => {
            const text = textOf(message);
            const final = finals[message.id];
            const inFlight = chat.isLoading && message.id === last?.id;
            if (message.role === 'user') {
              const reply = chat.messages[index + 1];
              const pending = chat.isLoading && !reply && message.id === last?.id;
              // Stopped before a checked answer, even before any text arrived.
              const wasStopped = stopped.includes(message.id) && !(reply && finals[reply.id]) && !pending;
              return (
                <div key={message.id} className="space-y-4">
                  <div dir="auto" className="ms-8 whitespace-pre-wrap rounded-xl bg-primary/10 p-3">
                    {text}
                  </div>
                  {wasStopped && (
                    <div className="space-y-2 rounded-xl border border-dashed p-4 text-muted-foreground text-sm">
                      <p>{t('aiStopped')}</p>
                      <Button size="sm" variant="outline" disabled={answering} onClick={() => askAgain(text)}>
                        {t('aiRetry')}
                      </Button>
                    </div>
                  )}
                </div>
              );
            }
            if (!final && !inFlight) {
              // Ended without a checked answer: its unchecked text is never shown.
              // A stopped one is noted with its question; a refused run (quota,
              // limits) leaves an empty shell; the error box explains the latest failure.
              const asked = chat.messages[index - 1];
              if (!text || (asked && stopped.includes(asked.id)) || (code && message.id === last?.id)) return null;
              return (
                <p key={message.id} className="rounded-xl border border-dashed p-4 text-muted-foreground text-sm">
                  {t('aiFailed')}
                </p>
              );
            }
            // Before the first token the typing indicator stands in.
            if (!text && !final) return null;
            return (
              <ChatMessage
                key={message.id}
                text={text}
                final={final}
                options={options}
                busy={chat.isLoading && !final}
                scope={turnScopes.current[message.id]}
                consent={consent()}
                close={() => options.onOpenChange(false)}
                followUps={!answering && message.id === latestAnswer?.id ? followUps[message.id] : undefined}
                onFollowUp={(question, position) => {
                  track({ name: 'follow_up_clicked', conversationId, turnId: message.id, position });
                  send(question);
                }}
                onSourceOpen={(source, position) => {
                  track({ name: 'citation_clicked', conversationId, turnId: message.id, citationId: source.id, position });
                  // Navigating away: send what is queued now.
                  events.flush();
                }}
                onCopy={() => track({ name: 'copy', conversationId, turnId: message.id })}
              />
            );
          })}
          {answering &&
            (streaming ? (
              <p aria-hidden className="text-muted-foreground text-sm">
                {phaseLabel}
              </p>
            ) : (
              <Typing label={t('aiTyping')} phase={phaseLabel} />
            ))}
          {code && (
            <div className="space-y-2 rounded-lg bg-muted p-3">
              <p>{t(errorKey(code))}</p>
              {code === 'conversation_limit' ? (
                <Button onClick={() => askInNewChat(lastQuestion)}>{t('aiNew')}</Button>
              ) : (
                !['quota_exhausted', 'budget_exhausted'].includes(code) && (
                  <Button disabled={answering} onClick={() => askAgain(lastQuestion)}>
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
          <Composer lang={options.lang} busy={answering} value={typed} setValue={setTyped} field={field} send={send} stop={stop} />
          <p className="text-muted-foreground text-xs">{t('aiCaution')}</p>
          {/* Said only when the server keeps question text and this reader's consent lets it. */}
          {retainedDays !== null && <p className="text-muted-foreground text-xs">{t('aiSaved', { count: retainedDays })}</p>}
        </footer>
      </SheetContent>
    </Sheet>
  );
}
