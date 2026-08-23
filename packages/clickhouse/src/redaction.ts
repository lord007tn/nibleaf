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
