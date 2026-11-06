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

/** Redact before queueing; Unicode digits cover Arabic and Persian identifiers. */
export const redactConversationText = (text: string, limit = 16_000): string =>
  text
    .replace(/https?:\/\/[^\s<>]+/giu, (url) => url.split(/[?#]/u)[0] ?? '')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/giu, '[REDACTED]')
    .replace(/\b(?:Bearer\s+\S+|sk-[\w-]+|eyJ[\w-]+\.[\w-]+\.[\w-]+|[a-f0-9]{32,})\b/giu, '[REDACTED]')
    .replace(/\+?[\p{Nd}][\p{Nd}\s().-]{5,}[\p{Nd}]/gu, '[REDACTED]')
    .slice(0, Math.min(limit, 16_000));
