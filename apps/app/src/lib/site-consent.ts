import { readSiteStorage, writeSiteStorage } from './site-storage';

type Choice = 'accepted' | 'declined' | 'pending';
const ephemeral = new WeakMap<Document, Map<string, Choice>>();
const storageKey = (projectId: string) => `nibleaf.analytics.consent.${projectId}`;
/** Fired on this window when a choice is written here; other tabs hear the `storage` event. */
const CHANGE_EVENT = 'nibleaf:site-consent';
/** Fired when the reader asks to change their choice (the footer's "Privacy choices"). */
const MANAGE_EVENT = 'nibleaf:site-consent-manage';

/** Reopen this site's consent banner, so the reader can change their choice. */
export const openSiteConsentChoices = (projectId: string) => {
  window.dispatchEvent(new CustomEvent(MANAGE_EVENT, { detail: projectId }));
};

/** Calls `onManage` when the reader asks to change this site's choice. */
export const subscribeSiteConsentManage = (projectId: string, onManage: () => void): (() => void) => {
  const listener = (event: Event) => {
    if (event instanceof CustomEvent && event.detail === projectId) onManage();
  };
  window.addEventListener(MANAGE_EVENT, listener);
  return () => window.removeEventListener(MANAGE_EVENT, listener);
};

export const readSiteConsent = (projectId: string): Choice => {
  if (typeof document === 'undefined') return 'pending';
  const stored = readSiteStorage('localStorage', storageKey(projectId));
  return stored === 'accepted' || stored === 'declined' ? stored : (ephemeral.get(document)?.get(projectId) ?? 'pending');
};

/** A blocked storage API still honors the choice on this document. */
export const writeSiteConsent = (projectId: string, choice: Exclude<Choice, 'pending'>) => {
  if (typeof document === 'undefined') return;
  if (writeSiteStorage('localStorage', storageKey(projectId), choice)) {
    ephemeral.get(document)?.delete(projectId);
  } else {
    const choices = ephemeral.get(document) ?? new Map<string, Choice>();
    choices.set(projectId, choice);
    ephemeral.set(document, choices);
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: projectId }));
};

/** Calls `onChange` whenever this site's consent choice changes: written in
 * this tab (the banner), or in another tab of the same site (`storage`). */
export const subscribeSiteConsent = (projectId: string, onChange: () => void): (() => void) => {
  if (typeof window === 'undefined') return () => undefined;
  const onLocal = (event: Event) => {
    if (!(event instanceof CustomEvent) || event.detail === projectId) onChange();
  };
  // `key` is null when another tab cleared storage altogether.
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === storageKey(projectId)) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onLocal);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onLocal);
    window.removeEventListener('storage', onStorage);
  };
};
