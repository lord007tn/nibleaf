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

/**
 * Started when the person copies or installs from the Connect card.
 * `baseline` is every grant that existed before; `null` until the app list has
 * loaded, so a list that was still loading can't make old grants look new.
 */
export interface ConnectWatch {
  client: AssistantClient;
  baseline: readonly string[] | null;
  until: number;
}

export type WatchState =
  | { kind: 'waiting' }
  /** A new grant by this person, named like the chosen app: allowed, no successful call yet. */
  | { kind: 'authorized'; app: WatchedApp }
  /** That grant has made a call that succeeded. */
  | { kind: 'working'; app: WatchedApp }
  /** Allowed, but no successful call before the deadline. */
  | { kind: 'stalled'; app: WatchedApp }
  /** A new grant by this person appeared, but its name doesn't match the chosen app. */
  | { kind: 'unexpected'; app: WatchedApp }
  | { kind: 'timedOut' };

/** Audit outcomes that mean a call finished successfully. `started` is recorded before a write runs. */
const SUCCEEDED = new Set(['succeeded', 'replayed']);

/** What each app tends to call itself when it registers. Self-reported, so a hint, not proof. */
const CLIENT_NAME: Record<AssistantClient, (name: string) => boolean> = {
  chatgpt: (name) => /chatgpt|openai/i.test(name),
  claude: (name) => /claude/i.test(name) && !/claude[\s_-]*code/i.test(name),
  claudeCode: (name) => /claude[\s_-]*code/i.test(name),
  cursor: (name) => /cursor/i.test(name),
  vscode: (name) => /visual studio code|vs\s?code|copilot/i.test(name),
};

export const startWatch = (client: AssistantClient, apps: readonly { id: string }[] | undefined, now: number): ConnectWatch => ({
  client,
  baseline: apps ? apps.map((app) => app.id) : null,
  until: now + WATCH_MS,
});

/** Fills in the baseline once the app list has loaded. */
export const withBaseline = (watch: ConnectWatch, apps: readonly { id: string }[]): ConnectWatch =>
  watch.baseline ? watch : { ...watch, baseline: apps.map((app) => app.id) };

/** Watch again for another ten minutes, keeping what counted as "before". */
export const restartWatch = (watch: ConnectWatch, now: number): ConnectWatch => ({ ...watch, until: now + WATCH_MS });

/**
 * What the Connect card says about the app being set up. Only grants created
 * after the watch started, by this person, count, so a connection made earlier
 * or by a teammate never reads as connected. "Working" needs a call that
 * succeeded, not just a token or a write that has only started.
 */
export function watchState(watch: ConnectWatch, apps: readonly WatchedApp[], now: number): WatchState {
  const expired = now >= watch.until;
  const { baseline } = watch;
  if (!baseline) return expired ? { kind: 'timedOut' } : { kind: 'waiting' };
  const fresh = apps
    .filter((app) => app.ownedByViewer && !baseline.includes(app.id))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const matching = fresh.filter((app) => CLIENT_NAME[watch.client](app.name));
  const working = matching.find((app) => app.lastActivity !== null && SUCCEEDED.has(app.lastActivity.outcome));
  if (working) return { kind: 'working', app: working };
  const allowed = matching[0];
  if (allowed) return expired ? { kind: 'stalled', app: allowed } : { kind: 'authorized', app: allowed };
  const other = fresh[0];
  if (other) return { kind: 'unexpected', app: other };
  return expired ? { kind: 'timedOut' } : { kind: 'waiting' };
}

/** Keep polling the app list while something may still change. */
export const keepWatching = (state: WatchState, watch: ConnectWatch, now: number) =>
  (state.kind === 'waiting' || state.kind === 'authorized' || state.kind === 'unexpected') && now < watch.until;

/** The card offers "Watch again" once the deadline passed without a working app. */
export const canRestart = (state: WatchState) => state.kind === 'stalled' || state.kind === 'timedOut';
