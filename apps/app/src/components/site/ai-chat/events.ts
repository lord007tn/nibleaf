import type { AiChatClientEvent, SiteChatEventsBody } from '@nibleaf/validators';
/** Each batch retains the consent/identity metadata present when it was tracked. */
export const createChatEventQueue = (send: (body: SiteChatEventsBody) => Promise<unknown>) => {
  let pending: SiteChatEventsBody | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let listening = false;
  const flush = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (listening) {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', flush);
      listening = false;
    }
    const batch = pending;
    pending = undefined;
    if (batch) {
      try {
        void send(batch).catch(() => undefined);
      } catch {
        // Unload telemetry remains best effort even if transport throws synchronously.
      }
    }
  };
  const hidden = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  const track = (event: AiChatClientEvent, meta: Omit<SiteChatEventsBody, 'events'>) => {
    if (pending && (pending.consent !== meta.consent || pending.sessionId !== meta.sessionId || pending.lang !== meta.lang)) flush();
    pending ??= { ...meta, events: [] };
    pending.events.push(event);
    if (pending.events.length === 20) {
      flush();
      return;
    }
    timer ??= setTimeout(flush, 1000);
    if (!listening && typeof document !== 'undefined' && typeof window !== 'undefined') {
      document.addEventListener('visibilitychange', hidden);
      window.addEventListener('pagehide', flush);
      listening = true;
    }
  };
  return { track, flush };
};
