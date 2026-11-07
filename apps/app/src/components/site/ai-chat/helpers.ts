import type { AiChatConsent, AiChatErrorCode, AiChatFinalEvent, AiChatHistoryMessage } from '@nibleaf/validators';

export function deriveConsent(required: boolean, stored: string | null): AiChatConsent {
  if (!required) return 'not_required';
  return stored === 'accepted' ? 'granted' : stored === 'declined' ? 'denied' : 'unknown';
}
export function buildHistory(turns: Array<{ question: string; final: AiChatFinalEvent }>): AiChatHistoryMessage[] {
  return turns
    .flatMap(({ question, final }): AiChatHistoryMessage[] => [
      { role: 'user', content: question.trim().slice(0, 4000) },
      { role: 'assistant', content: final.answer.trim().slice(0, 4000) },
    ])
    .filter(({ content }) => content.length > 0)
    .slice(-12);
}
export function citationParts(text: string) {
  return text
    .split(/(\[S\d+\])/g)
    .filter(Boolean)
    .map((value, index) => ({ key: index, text: value, source: /^\[(S\d+)\]$/.exec(value)?.[1] }));
}
/** Citation markers (`[S1]`, `[S1, S2]`) only mean something once the answer is checked. */
// Every repetition consumes a separator and an S id, and the marker starts at a
// literal bracket (one optional space before it), so matching stays linear.
const CITATION_MARKERS = / ?\[S\d+(?:[ \t]*[,;،؛][ \t]*S\d+)*\]/g;
/** Characters a marker can hold before its closing bracket (one class, no nesting). */
const MARKER_BODY = /^[S\d,;،؛\s]*$/;
/** Drops a marker still arriving at the end of the stream ("[", "[S", "[S6",
 * "[S6, S"). Text like `items[0` is left alone: a marker starts with S. */
const withoutUnfinishedMarker = (text: string) => {
  const open = text.lastIndexOf('[');
  if (open < 0) return text;
  const body = text.slice(open + 1);
  if (body.length > 40 || (body && !body.startsWith('S')) || !MARKER_BODY.test(body)) return text;
  return text.slice(0, open).trimEnd();
};
/** The checked answer once it arrives; until then the streamed text, without
 * markers, including one split across chunks that has not closed yet. */
export const answerText = (streamed: string, final?: AiChatFinalEvent) =>
  final ? final.answer : withoutUnfinishedMarker(streamed.replace(CITATION_MARKERS, ''));
export const errorKey = (code: AiChatErrorCode | 'offline') =>
  (
    ({
      quota_exhausted: 'aiQuota',
      budget_exhausted: 'aiQuota',
      rate_limited: 'aiRate',
      conversation_limit: 'aiLimit',
      unavailable: 'aiUnavailable',
      invalid_request: 'aiInvalid',
      failed: 'aiFailed',
      offline: 'aiOffline',
    }) as const
  )[code];
export const upstreamError = (status: number): AiChatErrorCode =>
  status === 429
    ? 'rate_limited'
    : status === 400 || status === 422
      ? 'invalid_request'
      : status === 404 || status === 503
        ? 'unavailable'
        : 'failed';
export function errorSse(conversationId: string, runId: string, code: AiChatErrorCode): string {
  return [
    { type: 'RUN_STARTED', threadId: conversationId, runId },
    { type: 'CUSTOM', name: 'nibleaf.chat.error', value: { code } },
    { type: 'RUN_ERROR', code, message: 'Unable to answer.' },
  ]
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join('');
}
