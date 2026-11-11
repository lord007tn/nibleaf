import type { MessageKey } from '@nibleaf/i18n';

/** Most addresses one invitation request takes (the server's limit). */
const MAX_INVITE_EMAILS = 100;

// Deliberately simple: one @, something on both sides, a dot in the domain. The
// server is the authority; this only catches typos before the request.
const EMAIL = /^[^\s@,;<>()]+@[^\s@,;<>()]+\.[^\s@,;<>()]+$/;
const isEmail = (value: string) => EMAIL.test(value.trim());

/** Addresses typed or pasted into the invite box: commas, semicolons, spaces or new lines separate them. */
export function parseEmails(text: string): { valid: string[]; invalid: string[] } {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    // "Lina <lina@acme.com>" pasted from a mail client keeps only the address.
    const token = raw.replace(/^<|>$/g, '').trim();
    if (!token) continue;
    const email = token.toLowerCase();
    if (seen.has(email)) continue;
    seen.add(email);
    (isEmail(email) ? valid : invalid).push(email);
  }
  return { valid, invalid };
}

export type EmailsError = { key: MessageKey; values?: Record<string, string | number> } | null;

/** The invite box's error, if any. Shown only after blur or submit (design: no red on an untouched form). */
export function emailsError(text: string, { single = false }: { single?: boolean } = {}): EmailsError {
  const { valid, invalid } = parseEmails(text);
  if (!valid.length && !invalid.length) return { key: single ? 'people.invite.error.emailRequired' : 'people.invite.error.emailsRequired' };
  if (invalid.length) return { key: 'people.invite.error.invalid', values: { emails: invalid.slice(0, 3).join(', ') } };
  if (single && valid.length > 1) return { key: 'people.invite.error.oneAddress' };
  if (valid.length > MAX_INVITE_EMAILS) return { key: 'people.invite.error.tooMany', values: { max: MAX_INVITE_EMAILS } };
  return null;
}

const DAY = 86_400_000;
/** An invitation's lifetime as the list shows it. */
export function invitationTiming(expiresAt: string | Date, now = Date.now()): { expired: boolean; daysLeft: number } {
  const left = new Date(expiresAt).getTime() - now;
  return { expired: left <= 0, daysLeft: Math.max(0, Math.ceil(left / DAY)) };
}

/** What happened to an invitation's email (server `delivery`): queued for sending, not queued, or no email at all. */
export type InvitationDelivery = 'queued' | 'failed' | 'disabled';

export const DELIVERY_VIEW: Record<InvitationDelivery, { label: MessageKey; tone: 'success' | 'danger' | 'neutral' }> = {
  queued: { label: 'people.delivery.queued', tone: 'success' },
  failed: { label: 'people.delivery.failed', tone: 'danger' },
  disabled: { label: 'people.delivery.disabled', tone: 'neutral' },
};

/** One line for the invite result: all queued, emails off, or how many couldn't be queued. Never "sent": the worker sends. */
export function deliverySummary(deliveries: InvitationDelivery[]): { key: MessageKey; count?: number } {
  const failed = deliveries.filter((delivery) => delivery === 'failed').length;
  if (failed) return { key: 'people.invite.someFailed', count: failed };
  if (deliveries.length && deliveries.every((delivery) => delivery === 'disabled')) return { key: 'people.invite.notEmailed' };
  return { key: 'people.invite.emailed' };
}
