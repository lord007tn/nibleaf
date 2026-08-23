const SECRET_KEY = /(?:authorization|cookie|email|password|prompt|query|secret|token)/iu;

/** Redact nested diagnostics before they reach logs. Analytics payload content,
 * credentials, and request headers are never safe operational dimensions. */
export const redactAnalyticsDiagnostics = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redactAnalyticsDiagnostics);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SECRET_KEY.test(key) ? '[REDACTED]' : redactAnalyticsDiagnostics(item),
    ]),
  );
};
