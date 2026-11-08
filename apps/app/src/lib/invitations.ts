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

/** Copy text with the standard Clipboard API. */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
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

/**
 * Where a visitor goes right after authenticating: the invitation named in the
 * auth page's URL, else the remembered pending destination, else nothing (the
 * caller's default). The (auth) layout's redirect and the sign-in/up pages use
 * the same answer, so a sign-in never races two different destinations.
 */
export function afterAuthDestination(search: { invite?: string | null } | undefined): string | null {
  if (search?.invite) return invitationPath(search.invite);
  return typeof window === 'undefined' ? null : readPendingDestination();
}
