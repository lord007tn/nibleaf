import { readSiteStorage, writeSiteStorage } from './site-storage';

type Choice = 'accepted' | 'declined' | 'pending';
const ephemeral = new WeakMap<Document, Map<string, Choice>>();

export const readSiteConsent = (projectId: string): Choice => {
  if (typeof document === 'undefined') return 'pending';
  const stored = readSiteStorage('localStorage', `nibleaf.analytics.consent.${projectId}`);
  return stored === 'accepted' || stored === 'declined' ? stored : (ephemeral.get(document)?.get(projectId) ?? 'pending');
};

/** A blocked storage API still honors the choice on this document. */
export const writeSiteConsent = (projectId: string, choice: Exclude<Choice, 'pending'>) => {
  if (typeof document === 'undefined') return;
  if (writeSiteStorage('localStorage', `nibleaf.analytics.consent.${projectId}`, choice)) {
    ephemeral.get(document)?.delete(projectId);
    return;
  }
  const choices = ephemeral.get(document) ?? new Map<string, Choice>();
  choices.set(projectId, choice);
  ephemeral.set(document, choices);
};
