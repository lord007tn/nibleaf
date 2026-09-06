/** Coolify may return literal environment values wrapped in one matching pair
 * of quotes even when the effective Compose value is unquoted. Normalize only
 * that provider representation; embedded or unmatched quotes remain intact. */
export const normalizeCoolifyLiteral = (value) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  const first = trimmed[0];
  if (trimmed.length >= 2 && (first === "'" || first === '"') && trimmed.at(-1) === first) return trimmed.slice(1, -1);
  return trimmed;
};
