import type { AssistantClient } from './clients';

/** How long the page watches for an app after the person copies its setup. */
export const WATCH_MS = 10 * 60_000;

/** A signed-in app as the watch reads it. `name` is whatever the app registered: never proof of which app it is. */
export interface WatchedApp {
  id: string;
  name: string;
  createdAt: string;
  ownedByViewer: boolean;
  lastActivity: { outcome: string } | null;
}

/** Started when the person copies or installs from the Connect card. `baseline` is every grant that already existed. */
export interface ConnectWatch {
  client: AssistantClient;
  baseline: readonly string[];
  until: number;
}

export type WatchState =
  | { kind: 'waiting' }
  /** A new grant exists for this person on this website: the app was allowed, but hasn't called yet. */
  | { kind: 'authorized'; app: WatchedApp }
  /** That grant has made a call that didn't fail. */
  | { kind: 'working'; app: WatchedApp }
  | { kind: 'timedOut' };

export const startWatch = (client: AssistantClient, apps: readonly { id: string }[], now: number): ConnectWatch => ({
  client,
  baseline: apps.map((app) => app.id),
  until: now + WATCH_MS,
});

/**
 * What the Connect card says about the app being set up. Only grants created
 * after the watch started, by this person, count, so a connection made earlier
 * or by a teammate never reads as "connected". "Working" needs a call that
 * didn't fail, not just a token: an app is allowed before it ever calls.
 */
export function watchState(watch: ConnectWatch, apps: readonly WatchedApp[], now: number): WatchState {
  const fresh = apps
    .filter((app) => app.ownedByViewer && !watch.baseline.includes(app.id))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const working = fresh.find((app) => app.lastActivity && app.lastActivity.outcome !== 'failed');
  if (working) return { kind: 'working', app: working };
  const newest = fresh[0];
  if (newest) return { kind: 'authorized', app: newest };
  return now >= watch.until ? { kind: 'timedOut' } : { kind: 'waiting' };
}

/** Keep polling the app list while something may still change. */
export const keepWatching = (state: WatchState, watch: ConnectWatch, now: number) =>
  state.kind !== 'working' && state.kind !== 'timedOut' && now < watch.until;
