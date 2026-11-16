import { useSyncExternalStore } from 'react';

/** One theme write in flight (a save or an import), for the site it started on. */
export type Operation = { kind: 'save' | 'apply'; identity: string };

/**
 * The theme write in flight for each site, kept outside the form: the editor
 * remounts the section per site, and a write for site A still running when
 * A's form mounts again (A → B → A) must keep its turn and still show. Taking
 * a site's turn is synchronous, so no two writes for it can start; a write
 * gives it back only when it settles, and only its own. Every change is
 * published to the mounted forms.
 */
const owners = new Map<string, Operation>();
const listeners = new Set<() => void>();
const publish = () => {
  for (const listener of listeners) listener();
};

export function subscribeWrites(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const writeFor = (identity: string) => owners.get(identity);

/** Takes the site's turn, or returns `null` while another write holds it. */
export function acquireWrite(identity: string, kind: Operation['kind']): Operation | null {
  if (owners.has(identity)) return null;
  const owned = { kind, identity };
  owners.set(identity, owned);
  publish();
  return owned;
}

/** Gives the turn back if `owned` still holds it. */
export function releaseWrite(owned: Operation) {
  if (owners.get(owned.identity) !== owned) return;
  owners.delete(owned.identity);
  publish();
}

/** The write in flight for `identity`, re-rendering when it starts or ends. */
export const useWriteFor = (identity: string) =>
  useSyncExternalStore(
    subscribeWrites,
    () => owners.get(identity),
    () => owners.get(identity),
  );
