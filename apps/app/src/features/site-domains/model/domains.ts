/**
 * Site settings → Custom domain, as pure logic: what each setup stage looks
 * like, what a finished check tells the owner, how a typed domain is cleaned,
 * how DNS records are shown, and which row actions are allowed and why.
 * Rendered by `components/domain-settings.tsx`; tested in `domains.test.ts`.
 */
import type { MessageKey } from '@nibleaf/i18n';
import { isDomainLive } from '@nibleaf/shared/domains';
import { DOMAIN_NAME_PATTERN, normalizeDomainInput } from '@nibleaf/validators';
import { getDomain } from 'tldts';
import type { SiteAdminState } from '@/lib/project-settings-access';

/**
 * The fields of a custom domain this model reads: a structural copy of the
 * API's `Domain` (hooks/api/types.ts), so the model takes plain values and
 * imports nothing from the data layer.
 */
export type Domain = {
  id: string;
  domain: string;
  verified: boolean;
  isPrimary: boolean;
  dnsStatus: 'PENDING' | 'VERIFIED' | 'ERROR';
  sslStatus: 'PENDING' | 'PROVISIONING' | 'ACTIVE' | 'ERROR';
  lastError: string | null;
  records?: ReadonlyArray<unknown>;
};

export type DomainStage = 'waiting' | 'dnsProblem' | 'securing' | 'httpsProblem' | 'live';

/**
 * Where a domain is in its setup. The same rule as `domainStage` in
 * hooks/api/domain-state.ts (frozen until the organizations shell merges;
 * it should then re-export this one).
 */
export const domainStage = (domain: Pick<Domain, 'dnsStatus' | 'sslStatus'>): DomainStage => {
  if (domain.dnsStatus === 'ERROR') return 'dnsProblem';
  if (domain.dnsStatus !== 'VERIFIED') return 'waiting';
  if (domain.sslStatus === 'ACTIVE') return 'live';
  return domain.sslStatus === 'ERROR' ? 'httpsProblem' : 'securing';
};

/** The DS `StatusBadge` tones this section uses. */
export type DomainTone = 'success' | 'pending' | 'danger';

/** One badge and one explanation per setup step, so a row never says DNS is pending once it is not. */
export const STAGES: Record<DomainStage, { label: MessageKey; tone: DomainTone; help?: MessageKey }> = {
  waiting: { label: 'settings.domain.status.provisioning', tone: 'pending', help: 'settings.domain.state.waiting' },
  dnsProblem: { label: 'settings.domain.status.dnsError', tone: 'danger', help: 'settings.domain.state.dnsProblem' },
  securing: { label: 'settings.domain.status.sslProvisioning', tone: 'pending', help: 'settings.domain.state.securing' },
  httpsProblem: { label: 'settings.domain.status.sslError', tone: 'danger', help: 'settings.domain.state.httpsProblem' },
  live: { label: 'settings.domain.status.verified', tone: 'success' },
};

/** The badge a row shows: its stage, or "Checking…" while a check of that domain runs. */
export function domainBadge(stage: DomainStage, checking: boolean): { label: MessageKey; tone: DomainTone } {
  if (checking) return { label: 'settings.domain.status.checking', tone: 'pending' };
  const { label, tone } = STAGES[stage];
  return { label, tone };
}

export type ToastKind = 'success' | 'info' | 'warning' | 'error';

/** What a finished check means for the owner, worded for the state it found. */
export const CHECK_RESULT: Record<DomainStage, { key: MessageKey; kind: ToastKind }> = {
  live: { key: 'settings.domain.toast.live', kind: 'success' },
  securing: { key: 'settings.domain.toast.provisioning', kind: 'info' },
  waiting: { key: 'settings.domain.toast.waiting', kind: 'info' },
  dnsProblem: { key: 'settings.domain.toast.needsAttention', kind: 'error' },
  httpsProblem: { key: 'settings.domain.toast.needsAttention', kind: 'error' },
};

/** A message to toast; `withDomain` messages take the checked host as `{domain}`. */
export type DomainToast = { kind: ToastKind; key: MessageKey; withDomain?: boolean };

type CheckResult = Pick<Domain, 'dnsStatus' | 'sslStatus'> & { demoted?: boolean; ownershipRecordMissing?: boolean };

/**
 * The toasts for a check that came back. Losing the main address outranks the
 * stage; a live domain whose TXT record was removed is still live, but later
 * checks can't re-confirm ownership, so the owner is told to add it back.
 */
export function checkOutcome(result: CheckResult): { toasts: DomainToast[]; revealRecords: boolean } {
  if (result.demoted) return { toasts: [{ kind: 'warning', key: 'settings.domain.toast.demoted', withDomain: true }], revealRecords: true };
  const toasts: DomainToast[] = [CHECK_RESULT[domainStage(result)]];
  if (result.ownershipRecordMissing) toasts.push({ kind: 'info', key: 'settings.domain.toast.txtMissing', withDomain: true });
  return { toasts, revealRecords: Boolean(result.ownershipRecordMissing) };
}

/** The toasts for a check that failed: only losing the main address is said here; the reason is toasted by the mutation. */
export const checkFailureToasts = (demoted: boolean): DomainToast[] =>
  demoted ? [{ kind: 'warning', key: 'settings.domain.toast.demoted', withDomain: true }] : [];

/** The address to link a row to. Linking one that doesn't serve the docs yet would only open a browser error. */
export const domainHref = (domain: Pick<Domain, 'domain' | 'verified' | 'dnsStatus' | 'sslStatus'>): string | null =>
  isDomainLive(domain) ? `https://${domain.domain}` : null;

/** A root domain (`example.com`, `example.co.uk`) often can't take a CNAME record. */
export const isApexDomain = (domain: string) => getDomain(domain) === domain;

/** What was typed or pasted (`https://Docs.Example.com/help`), reduced to what will be connected, and whether that is a domain. */
export function cleanDomainInput(raw: string): { cleaned: string; valid: boolean; apex: boolean } {
  const cleaned = normalizeDomainInput(raw);
  const valid = DOMAIN_NAME_PATTERN.test(cleaned);
  return { cleaned, valid, apex: valid && isApexDomain(cleaned) };
}

/**
 * What is wrong with the add field. An empty field is only a problem when the
 * person tries to add it, so tabbing through the field shows nothing.
 */
export function domainInputProblem(raw: string, on: 'edit' | 'submit'): 'invalid' | undefined {
  const { cleaned, valid } = cleanDomainInput(raw);
  if (!cleaned) return on === 'submit' ? 'invalid' : undefined;
  return valid ? undefined : 'invalid';
}

/** Server refusals about the typed host itself; they go under the field. Anything else is a toast. */
const HOST_REFUSALS = new Set(['validation:failed', 'domain:already_added', 'domain:already_connected']);

export function addErrorTarget(error: unknown): 'field' | 'toast' {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && HOST_REFUSALS.has(code) ? 'field' : 'toast';
}

export type DnsRecordView = {
  key: string;
  type: string;
  /** The name relative to the zone (`docs`, `_nibleaf.docs`, `@`), what most providers ask for. */
  host: string;
  /** The fully qualified name, shown too when it differs from `host`. */
  fullName: string;
  value: string;
  purpose: MessageKey;
};

/** A DNS record as the owner types it at their provider. */
export function dnsRecordView(record: { type: string; name: string; value: string }, domain: string): DnsRecordView {
  const zone = getDomain(domain);
  const fullName = record.name.replace(/\.$/, '');
  const host = zone && fullName.endsWith(`.${zone}`) ? fullName.slice(0, -(zone.length + 1)) : fullName === zone ? '@' : fullName;
  // The CNAME on the address itself routes readers; every other record proves control of the domain.
  const purpose: MessageKey =
    record.type === 'CNAME' && fullName === domain ? 'settings.domain.dns.purpose.cname' : 'settings.domain.dns.purpose.txt';
  return { key: `${record.type}:${record.name}:${record.value}`, type: record.type, host, fullName, value: record.value, purpose };
}

/**
 * Where a domain's setup details stand. A domain still being set up shows its
 * steps and records open, and the steps only once there are records to follow.
 * A live one keeps its records folded but reachable: an owner who removed the
 * TXT record needs its value again to add it back.
 */
export function setupDetails(domain: Pick<Domain, 'dnsStatus' | 'sslStatus' | 'domain' | 'lastError' | 'records'>): {
  /** Whether the row has anything to unfold at all. */
  hasDetails: boolean;
  openByDefault: boolean;
  hasRecords: boolean;
  showSteps: boolean;
  apexHint: boolean;
  /** The server's own wording: English and technical, kept for support behind a disclosure. */
  technicalError: string | null;
} {
  const live = domainStage(domain) === 'live';
  const hasRecords = Boolean(domain.records?.length);
  const apexHint = !live && isApexDomain(domain.domain);
  const technicalError = live ? null : domain.lastError || null;
  return {
    hasDetails: hasRecords || apexHint || technicalError !== null,
    openByDefault: !live,
    hasRecords,
    showSteps: !live && hasRecords,
    apexHint,
    technicalError,
  };
}

/** `allowed`, `locked` (access unknown: disabled, nothing said), or `denied` with the reason shown. */
export type Decision = { kind: 'allowed' } | { kind: 'locked' } | { kind: 'denied'; reason: MessageKey };

const allowed: Decision = { kind: 'allowed' };
const locked: Decision = { kind: 'locked' };
const denied = (reason: MessageKey): Decision => ({ kind: 'denied', reason });

/** Whether the section shows its controls: admins manage, others read; unknown access shows them locked. */
export function domainAccess(status: SiteAdminState): { canManage: boolean; readOnly: boolean; locked: boolean } {
  return { canManage: status !== 'notAdmin', readOnly: status === 'notAdmin', locked: status === 'pending' };
}

/** Adding a domain: only admins; locked while access is unknown. */
export const addDecision = (status: SiteAdminState): Decision | null => (status === 'notAdmin' ? null : status === 'pending' ? locked : allowed);

export type RowActionState = {
  /** `null`: the action isn't offered on this row at all. */
  check: Decision | null;
  setPrimary: Decision | null;
  remove: Decision | null;
};

/** What is in flight for this site's domains: at most one of these at a time. */
export type DomainActivity = { checkingId?: string; primaryId?: string; removingId?: string };

/**
 * Which actions a domain row offers, and why one can't be used now. Non-admins
 * get none (the section says once why it is read-only).
 *
 * Checks, main-address changes and removals all change which domain is the
 * main address (a failed check can demote it), and they share one request
 * per kind. So while any of them runs, every conflicting action on every row
 * waits, with the reason shown.
 */
export function domainRowActions(
  domain: Pick<Domain, 'id' | 'isPrimary' | 'dnsStatus' | 'sslStatus'>,
  status: SiteAdminState,
  activity: DomainActivity = {},
): RowActionState {
  if (status === 'notAdmin') return { check: null, setPrimary: null, remove: null };
  if (status === 'pending') return { check: locked, setPrimary: domain.isPrimary ? null : locked, remove: locked };
  const busy = activity.checkingId ?? activity.primaryId ?? activity.removingId;
  const waiting = busy === undefined ? null : denied(activity.checkingId !== undefined ? 'settings.domain.status.checking' : 'common.saving');
  const check = waiting ?? allowed;
  let setPrimary: Decision | null = null;
  if (!domain.isPrimary) setPrimary = domainStage(domain) !== 'live' ? denied('settings.domain.reason.verifyFirst') : (waiting ?? allowed);
  return { check, setPrimary, remove: waiting ?? allowed };
}

/** A decision as the props a control takes: disabled, with the reason when there is one. */
export function decisionProps(decision: Decision): { disabled: boolean; reason?: MessageKey } {
  if (decision.kind === 'allowed') return { disabled: false };
  if (decision.kind === 'locked') return { disabled: true };
  return { disabled: true, reason: decision.reason };
}
