import type { MessageKey } from '@nibleaf/i18n';
import { isElevatedLinkRole, type SiteRole } from './roles';

export type JoinLinkStatus = 'active' | 'expired' | 'used_up' | 'revoked';

/** A link's state in words and tone. Revoked covers "disabled" and "its creator can no longer grant this". */
export const JOIN_LINK_STATUS: Record<JoinLinkStatus, { label: MessageKey; tone: 'success' | 'neutral' | 'warning' }> = {
  active: { label: 'people.links.status.active', tone: 'success' },
  expired: { label: 'people.links.status.expired', tone: 'neutral' },
  used_up: { label: 'people.links.status.usedUp', tone: 'neutral' },
  revoked: { label: 'people.links.status.disabled', tone: 'neutral' },
};

/** Active links can be regenerated or disabled; the rest only deleted (WORKSPACE-12: no pile of dead links). */
export const linkActions = (status: JoinLinkStatus) =>
  status === 'active' ? { regenerate: true, disable: true, delete: false } : { regenerate: false, disable: false, delete: true };

export const EXPIRY_OPTIONS = ['never', '1', '7', '30'] as const;
export type ExpiryOption = (typeof EXPIRY_OPTIONS)[number];
export const EXPIRY_LABEL: Record<ExpiryOption, MessageKey> = {
  never: 'people.links.expiry.never',
  '1': 'people.links.expiry.days1',
  '7': 'people.links.expiry.days7',
  '30': 'people.links.expiry.days30',
};

export interface JoinLinkDraft {
  label: string;
  grants: Record<string, SiteRole>;
  allowedDomain: string;
  maxUses: string;
  expiry: ExpiryOption;
}

/** A new link: no label, nothing granted yet, no domain rule, unlimited uses, a week. */
export const DEFAULT_JOIN_DRAFT: JoinLinkDraft = { label: '', grants: {}, allowedDomain: '', maxUses: '', expiry: '7' };

/** "@acme.com", " ACME.com " → "acme.com". */
export const normalizeDomain = (value: string) => value.trim().replace(/^@+/, '').toLowerCase();
const DOMAIN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/;

export type JoinLinkErrors = Partial<Record<'grants' | 'allowedDomain' | 'maxUses' | 'label', MessageKey>>;

export function joinLinkErrors(draft: JoinLinkDraft): JoinLinkErrors {
  const errors: JoinLinkErrors = {};
  if (!Object.keys(draft.grants).length) errors.grants = 'people.links.error.website';
  const domain = normalizeDomain(draft.allowedDomain);
  if (domain && !DOMAIN.test(domain)) errors.allowedDomain = 'people.links.error.domain';
  const uses = draft.maxUses.trim();
  if (uses && !(/^\d+$/.test(uses) && Number(uses) >= 1 && Number(uses) <= 10_000)) errors.maxUses = 'people.links.error.maxUses';
  if (draft.label.trim().length > 60) errors.label = 'people.links.error.label';
  return errors;
}

/** The request body for a valid draft. */
export function joinLinkBody(draft: JoinLinkDraft) {
  const domain = normalizeDomain(draft.allowedDomain);
  const uses = draft.maxUses.trim();
  return {
    label: draft.label.trim() || undefined,
    grants: Object.entries(draft.grants).map(([projectId, role]) => ({ projectId, role })),
    allowedDomain: domain || null,
    maxUses: uses ? Number(uses) : null,
    expiresInDays: draft.expiry === 'never' ? null : Number(draft.expiry),
  };
}

/** Admin or Editor through a link anyone can forward: warn before creating it. */
export const draftNeedsWarning = (draft: Pick<JoinLinkDraft, 'grants'>) => Object.values(draft.grants).some(isElevatedLinkRole);
