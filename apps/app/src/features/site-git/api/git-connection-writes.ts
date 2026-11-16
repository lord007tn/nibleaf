import type { QueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';

/**
 * The writes of a site's Git connection in flight (`PUT /git/connection`: the
 * first Connect and the connected save), per query client, session and site:
 * a count, nothing else (no request, body or token). A write started before
 * leaving and coming back to a site still makes it busy, and another
 * account's never does.
 */
type Writes = { counts: Map<string, number>; listeners: Set<() => void> };
const writesByClient = new WeakMap<QueryClient, Writes>();
const writesOf = (client: QueryClient): Writes => {
  let writes = writesByClient.get(client);
  if (!writes) {
    writes = { counts: new Map(), listeners: new Set() };
    writesByClient.set(client, writes);
  }
  return writes;
};
const slot = (generation: number, projectId: string) => JSON.stringify([generation, projectId]);

/** Whether a write of the site's connection is in flight in that session, read in the same tick. */
export const isWritingConnection = (client: QueryClient, generation: number, projectId: string) =>
  (writesOf(client).counts.get(slot(generation, projectId)) ?? 0) > 0;

/** Counts a write from now; call the returned release once, when it ends. */
export function startConnectionWrite(client: QueryClient, generation: number, projectId: string) {
  const key = slot(generation, projectId);
  const change = (by: 1 | -1) => {
    const { counts, listeners } = writesOf(client);
    const count = (counts.get(key) ?? 0) + by;
    if (count > 0) counts.set(key, count);
    else counts.delete(key);
    for (const listener of listeners) listener();
  };
  change(1);
  return () => change(-1);
}

/** No write is in flight while the server renders. */
const noServerWrite = () => false;

/** `isWritingConnection`, for rendering (server rendering included). */
export function useWritingConnection(client: QueryClient, generation: number, projectId: string) {
  const subscribe = useCallback(
    (listener: () => void) => {
      const { listeners } = writesOf(client);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    [client],
  );
  return useSyncExternalStore(subscribe, () => isWritingConnection(client, generation, projectId), noServerWrite);
}
