import { APP_URL } from '@/lib/links';

/** localStorage key holding an invitation id captured before the user authenticated. */
const PENDING_INVITE_KEY = 'nibleaf.pendingInvitation';

/** The shareable accept link for an invitation — works with or without email delivery. */
export const inviteAcceptUrl = (invitationId: string): string => {
  const origin = typeof window === 'undefined' ? APP_URL : window.location.origin;
  return `${origin}/accept-invite/${invitationId}`;
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

export function readPendingInvitation(): string | null {
  try {
    return window.localStorage.getItem(PENDING_INVITE_KEY);
  } catch {
    return null;
  }
}

export function setPendingInvitation(invitationId: string): void {
  try {
    window.localStorage.setItem(PENDING_INVITE_KEY, invitationId);
  } catch {
    // ignore storage failures
  }
}

export function clearPendingInvitation(): void {
  try {
    window.localStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    // ignore storage failures
  }
}
