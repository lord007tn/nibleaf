import { safeReturnPath } from './invitations';

/** Only dashboard paths can resume a dashboard name gate. Normalize before
 * checking the path so dot segments and backslashes cannot escape it. */
export function nameReturnPath(value: unknown): string {
  const path = safeReturnPath(value);
  if (!path) return '/app';
  const base = 'https://nibleaf.invalid';
  try {
    const url = new URL(path, base);
    const normalized = `${url.pathname}${url.search}${url.hash}`;
    return url.origin === base ? (safeReturnPath(normalized) ?? '/app') : '/app';
  } catch {
    return '/app';
  }
}
