import type { SiteChatEventsBody } from '@nibleaf/validators';

/** Analytics identity is created only after consent allows it, separately per site. */
export const readerSession = (projectId: string, consent: SiteChatEventsBody['consent']): string | undefined => {
  if (consent !== 'granted' && consent !== 'not_required') return undefined;
  try {
    const key = `nibleaf.chat.session.${projectId}`;
    const id = sessionStorage.getItem(key) ?? crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return undefined;
  }
};
