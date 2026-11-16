/**
 * Account data held in memory outside the query cache registers here, and is
 * dropped when the dashboard's session ends or changes (sign-out, another
 * account). This module imports nothing, so the session code that notifies it
 * stays free of whatever registers: a feature registers itself when it loads.
 */
const listeners = new Set<() => void>();

/** Run `listener` whenever the signed-in account's data is dropped. */
export function onSessionCleared(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The session ended or changed: every registered holder drops its data. */
export function notifySessionCleared(): void {
  for (const listener of listeners) listener();
}
