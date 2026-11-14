import { APP_URL } from '@/lib/links';

/** localStorage key holding the in-app page a visitor was on when they had to sign in first. */
const PENDING_DESTINATION_KEY = 'nibleaf.pendingDestination';
/** Earlier releases stored only an invitation id here; still honoured, then migrated. */
const LEGACY_PENDING_INVITE_KEY = 'nibleaf.pendingInvitation';

/** The shareable accept link for an invitation — works with or without email delivery. */
export const inviteAcceptUrl = (invitationId: string): string => {
  const origin = typeof window === 'undefined' ? APP_URL : window.location.origin;
  return `${origin}/accept-invite/${invitationId}`;
};

/** The in-app path of an invitation's accept page. */
const invitationPath = (invitationId: string): string => `/accept-invite/${encodeURIComponent(invitationId)}`;

/** A same-origin, in-app path (`/…`), never another origin (`//host`, `/\host`, `scheme:`). */
export const safeAppPath = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  return /^\/[^\s]*$/.test(value) ? value : null;
};

/** A dashboard page (`/app`, `/app/…`) to return to after signing in, with its query; anything else is dropped. */
export const safeReturnPath = (value: unknown): string | null => {
  const path = safeAppPath(value);
  return path && /^\/app(?:[/?#]|$)/.test(path) ? path : null;
};

/** Copy text with the standard Clipboard API, falling back to a selected
 *  off-screen field where that API is missing or refused (an insecure origin,
 *  an older browser, a denied permission). */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Try the fallback below.
    }
  }
  return copyWithSelection(text);
}

function copyWithSelection(text: string): boolean {
  if (typeof document === 'undefined' || typeof document.execCommand !== 'function') return false;
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.append(field);
  field.focus({ preventScroll: true });
  field.select();
  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    field.remove();
    previous?.focus();
  }
}

/** Where to return after sign-in or sign-up, if a page asked for it before the visitor authenticated. */
export function readPendingDestination(): string | null {
  try {
    const stored = safeAppPath(window.localStorage.getItem(PENDING_DESTINATION_KEY));
    if (stored) return stored;
    const legacyInvite = window.localStorage.getItem(LEGACY_PENDING_INVITE_KEY);
    return legacyInvite ? invitationPath(legacyInvite) : null;
  } catch {
    return null;
  }
}

/** Remember a page to return to once the visitor has signed in (an invitation, later a join link). */
export function setPendingDestination(path: string): void {
  const safe = safeAppPath(path);
  if (!safe) return;
  try {
    window.localStorage.setItem(PENDING_DESTINATION_KEY, safe);
    window.localStorage.removeItem(LEGACY_PENDING_INVITE_KEY);
  } catch {
    // ignore storage failures
  }
}

export function clearPendingDestination(): void {
  try {
    window.localStorage.removeItem(PENDING_DESTINATION_KEY);
    window.localStorage.removeItem(LEGACY_PENDING_INVITE_KEY);
  } catch {
    // ignore storage failures
  }
}

/** The invitation id of the pending destination, when it is an invitation's accept page. */
export function readPendingInvitation(): string | null {
  const match = readPendingDestination()?.match(/^\/accept-invite\/([^/?#]+)$/);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

export function setPendingInvitation(invitationId: string): void {
  setPendingDestination(invitationPath(invitationId));
}

export function clearPendingInvitation(): void {
  clearPendingDestination();
}

/** sessionStorage: the visitor chose "Create an account to accept" or "Log in to accept". */
const ACCEPT_INTENT_KEY = 'nibleaf.acceptInvitationAfterAuth';
/** Long enough to sign up with an emailed code; a stale choice never accepts. */
export const ACCEPT_INTENT_TTL_MS = 30 * 60 * 1000;

const readAcceptIntent = (): { id: string; at: number } | null => {
  try {
    const parsed = JSON.parse(window.sessionStorage.getItem(ACCEPT_INTENT_KEY) ?? 'null') as { id?: unknown; at?: unknown } | null;
    return parsed && typeof parsed.id === 'string' && typeof parsed.at === 'number' ? { id: parsed.id, at: parsed.at } : null;
  } catch {
    return null;
  }
};

/**
 * Remember that the visitor asked to accept this invitation once they are
 * signed in, so they are not asked a second time on their way back (P3-JRN-003).
 * Only an action on the accept page sets it, so a link alone can never accept
 * an invitation for someone. It lives in sessionStorage: it stays with this tab
 * (a tab this one opens gets a copy, as the browser copies session storage to
 * it) and lapses after `ACCEPT_INTENT_TTL_MS`.
 */
export function rememberAcceptIntent(invitationId: string, now = Date.now()): void {
  try {
    window.sessionStorage.setItem(ACCEPT_INTENT_KEY, JSON.stringify({ id: invitationId, at: now }));
  } catch {
    // Without storage they press Accept once more, as before.
  }
}

/** True once, when the visitor asked to accept this invitation in the last
 *  `ACCEPT_INTENT_TTL_MS`; the intent is used up either way. */
export function takeAcceptIntent(invitationId: string, now = Date.now()): boolean {
  const intent = readAcceptIntent();
  if (!intent || intent.id !== invitationId) return false;
  forgetAcceptIntent(invitationId);
  return now - intent.at >= 0 && now - intent.at <= ACCEPT_INTENT_TTL_MS;
}

/** Forget the intent: for one invitation only when `invitationId` is given. */
export function forgetAcceptIntent(invitationId?: string): void {
  try {
    if (invitationId !== undefined && readAcceptIntent()?.id !== invitationId) return;
    window.sessionStorage.removeItem(ACCEPT_INTENT_KEY);
  } catch {
    // ignore storage failures
  }
}

/**
 * Where a visitor goes right after authenticating: the invitation named in the
 * auth page's URL, else the dashboard page that sent them to sign in (`next`),
 * else the remembered pending destination, else nothing (the caller's default).
 * The (auth) layout's redirect and the sign-in/up pages use the same answer, so
 * a sign-in never races two different destinations.
 */
export function afterAuthDestination(search: { invite?: string | null; next?: string | null } | undefined): string | null {
  if (search?.invite) return invitationPath(search.invite);
  const next = safeReturnPath(search?.next);
  if (next) return next;
  return typeof window === 'undefined' ? null : readPendingDestination();
}

/** The `next` search value for an auth page, from the URL the visitor asked for (`/app` alone needs none). */
export function signInReturnSearch(href: string): { next?: string } {
  const next = safeReturnPath(href);
  return next && next !== '/app' && next !== '/app/' ? { next } : {};
}
