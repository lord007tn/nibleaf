/**
 * Site settings → Visibility & access, as pure logic: the three visibility
 * choices and what changing between them means, who may change what, and
 * when the access-request list shows. Rendered by
 * `components/reader-access-settings.tsx`; tested in `access.test.ts`.
 */
import type { MessageKey } from '@nibleaf/i18n';
import type { SiteAdminState } from '@/lib/project-settings-access';

/** Who can read the published site. */
export type AccessMode = 'PUBLIC' | 'WORKSPACE' | 'READERS';

/** The visibility choices, in the order they are offered, each with its icon name and copy. */
export const ACCESS_MODES: ReadonlyArray<{ mode: AccessMode; icon: 'globe' | 'users' | 'mail'; title: MessageKey; body: MessageKey }> = [
  { mode: 'PUBLIC', icon: 'globe', title: 'settings.visibility.public.title', body: 'settings.visibility.public.body' },
  { mode: 'WORKSPACE', icon: 'users', title: 'settings.visibility.team.title', body: 'settings.visibility.team.body' },
  { mode: 'READERS', icon: 'mail', title: 'settings.visibility.readers.title', body: 'settings.visibility.readers.body' },
];

/** What changing from `from` to `to` means for the people reading the site. */
export function visibilityChangeCopy(from: AccessMode, to: AccessMode): { title: MessageKey; description: MessageKey } {
  if (to === 'PUBLIC') return { title: 'settings.visibility.confirmPublicTitle', description: 'settings.visibility.confirmPublicBody' };
  if (from === 'PUBLIC') return { title: 'settings.visibility.confirmPrivateTitle', description: 'settings.visibility.confirmPrivateBody' };
  return to === 'WORKSPACE'
    ? { title: 'settings.visibility.confirmToTeamTitle', description: 'settings.visibility.confirmToTeamBody' }
    : { title: 'settings.visibility.confirmToReadersTitle', description: 'settings.visibility.confirmToReadersBody' };
}

/** Opening the site to everyone is the change that exposes content, so its confirmation is the destructive one. */
export const isExposingChange = (to: AccessMode) => to === 'PUBLIC';

// ─── Access ─────────────────────────────────────────────────────────────────

/**
 * What a control may do:
 * - `allowed`: usable;
 * - `locked`: disabled with nothing to say (access still loading);
 * - `denied`: disabled, with the reason shown next to it.
 */
export type Decision = { kind: 'allowed' } | { kind: 'locked' } | { kind: 'denied'; reason: MessageKey };

const allowed: Decision = { kind: 'allowed' };
const locked: Decision = { kind: 'locked' };
const denied = (reason: MessageKey): Decision => ({ kind: 'denied', reason });

/** `useProjectAdminStatus(projectId).edit`: whether the person may change content. */
export type EditStatus = 'pending' | 'edit' | 'viewOnly' | 'unknown';

/**
 * How the section renders for this person. Reader access is Admin-only on the
 * server, reads included, so someone who isn't an Admin gets one note saying
 * why (worded for Viewers when they are one) instead of a section that can't
 * load. While access is unknown the controls render locked.
 */
export type AccessView = { kind: 'manage' } | { kind: 'locked' } | { kind: 'readOnly'; note: MessageKey };

export function accessView(status: SiteAdminState, edit: EditStatus): AccessView {
  if (status === 'admin') return { kind: 'manage' };
  if (status === 'pending') return { kind: 'locked' };
  return { kind: 'readOnly', note: edit === 'viewOnly' ? 'settings.permissions.viewerBody' : 'settings.permissions.body' };
}

/**
 * The visibility choice: Admins only, and not while a change is being saved
 * (the confirmation dialog is open then, so the reason is for the moment it
 * closes). A non-Admin never gets this far (`accessView`).
 */
export function modeDecision(status: SiteAdminState, saving: boolean): Decision {
  if (status !== 'admin') return locked;
  return saving ? denied('common.saving') : allowed;
}

/**
 * Any other write on this screen (inviting, removing, saving settings): Admins
 * only; locked while access is unknown. `busy` locks a control while its own
 * write is in flight.
 */
export function manageDecision(status: SiteAdminState, busy = false): Decision {
  if (status !== 'admin') return locked;
  return busy ? denied('common.saving') : allowed;
}

/** A decision as the props a control takes: disabled, with the reason when there is one. */
export function decisionProps(decision: Decision): { disabled: boolean; reason?: MessageKey } {
  if (decision.kind === 'allowed') return { disabled: false };
  if (decision.kind === 'locked') return { disabled: true };
  return { disabled: true, reason: decision.reason };
}

// ─── Access requests ────────────────────────────────────────────────────────

/**
 * Whether the access-request list shows: while requests are on, and also
 * after they were turned off if some are still waiting, so none is forgotten.
 */
export const showsRequestList = (data: { readerAccessRequests: boolean; accessRequests: readonly unknown[] }) =>
  data.readerAccessRequests || data.accessRequests.length > 0;
