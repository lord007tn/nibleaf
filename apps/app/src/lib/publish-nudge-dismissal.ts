/**
 * Whether a site's first-publish checklist was dismissed: saved in localStorage
 * (shared across tabs, kept across visits) and, for this visit, in memory. The
 * memory copy covers storage that can't be written (private mode, a full quota,
 * blocked storage) and outlives the checklist itself, which unmounts while a
 * site's data loads, so going back to a dismissed site never shows it again.
 */
const storageKey = (projectId: string) => `nibleaf.publishNudge.${projectId}`;
const dismissedThisVisit = new Set<string>();
const listeners = new Set<() => void>();

export function subscribeNudgeDismissal(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

export function isNudgeDismissed(projectId: string): boolean {
  if (dismissedThisVisit.has(projectId)) return true;
  try {
    return window.localStorage.getItem(storageKey(projectId)) === '1';
  } catch {
    return false;
  }
}

export function dismissNudge(projectId: string): void {
  dismissedThisVisit.add(projectId);
  try {
    window.localStorage.setItem(storageKey(projectId), '1');
  } catch {
    // The in-memory copy keeps it dismissed for this visit.
  }
  for (const listener of listeners) listener();
}
