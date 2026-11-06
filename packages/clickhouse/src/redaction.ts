import { z } from 'zod';

const SECRET_KEY = /(?:authorization|cookie|email|password|prompt|query|secret|token)/iu;
const diagnosticObject = z.union([z.looseObject({}), z.function()]);

/** Redact nested diagnostics before they reach logs. Analytics payload content,
 * credentials, and request headers are never safe operational dimensions. */
export const redactAnalyticsDiagnostics = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactAnalyticsDiagnostics);
  const parsed = diagnosticObject.safeParse(value);
  if (!parsed.success) return value;
  return Object.fromEntries(
    Object.entries(parsed.data).map(([key, item]) => [key, SECRET_KEY.test(key) ? '[REDACTED]' : redactAnalyticsDiagnostics(item)]),
  );
};

/** Redact before queueing; Unicode digits cover Arabic and Persian identifiers.
 * Text may be model output steered by retrieved docs, so the input is bounded
 * before any pattern runs and patterns whose classes overlap use bounded runs
 * (an email's local part and domain, a phone number's digits and spacing). */
export const redactConversationText = (text: string, limit = 16_000): string =>
  text
    .slice(0, Math.min(limit, 16_000) + 256)
    .replace(/https?:\/\/[^\s<>]+/giu, (url) => url.split(/[?#]/u)[0] ?? '')
    .replace(/[\w.+-]{1,64}@[\w.-]{1,253}\.[a-z]{2,24}/giu, '[REDACTED]')
    .replace(/\b(?:Bearer\s+\S+|sk-[\w-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+|[a-f0-9]{32,})\b/giu, '[REDACTED]')
    .replace(/\+?[\p{Nd}][\p{Nd}\s().-]{5,40}[\p{Nd}]/gu, '[REDACTED]')
    .slice(0, Math.min(limit, 16_000));

/** Text people type (questions, comments) also loses whole links and long digit
 * runs, as search terms do (normalizeSearchTerm). Generated answers keep link
 * paths because they point into the documentation. */
export const redactReaderText = (text: string, limit = 16_000): string =>
  redactConversationText(
    text
      .slice(0, Math.min(limit, 16_000) + 256)
      .replace(/(?:https?:\/\/|www\.)\S+/giu, '[URL]')
      .replace(/\p{Nd}{6,}/gu, '[REDACTED]'),
    limit,
  );
