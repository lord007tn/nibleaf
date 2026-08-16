export type RedirectPair = { from: string; to: string };

export const normalizeRedirectPath = (path: string): string => {
  const value = path.trim();
  let start = 0;
  let end = value.length;
  while (start < end && value[start] === '/') start++;
  while (end > start && value[end - 1] === '/') end--;
  return value.slice(start, end);
};

const isExternalRedirect = (target: string): boolean => /^https?:\/\//i.test(target);

/** Resolve an internal redirect chain to one final target. Returning `null`
 * means no rule matched or the stored rules contain a cycle. This dependency-
 * free entrypoint is safe for the public reader bundle. */
export const resolveRedirectTarget = (redirects: readonly RedirectPair[], path: string): string | null => {
  const rules = new Map<string, string>();
  for (const rule of redirects) {
    const from = normalizeRedirectPath(rule.from);
    const to = rule.to.trim();
    if (rule.from.trim() && to && !rules.has(from)) rules.set(from, to);
  }

  let current = normalizeRedirectPath(path);
  const first = current;
  const visited = new Set<string>();
  while (true) {
    if (visited.has(current)) return null;
    visited.add(current);

    const target = rules.get(current);
    if (!target) return current === first ? null : `/${current}`;
    if (isExternalRedirect(target)) return target;
    current = normalizeRedirectPath(target);
  }
};
