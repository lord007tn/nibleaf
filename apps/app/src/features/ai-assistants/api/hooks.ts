import { useQuery } from '@tanstack/react-query';
import { connectedAppsQueryOptions } from '@/hooks/api/query-options';
import { type ConnectWatch, keepWatching, watchState } from '../model/connect-watch';

/** How often the app list is re-read while the Connect card waits for an app. */
const WATCH_POLL_MS = 5000;

/**
 * Signed-in apps for this website. While the Connect card watches for a new
 * app (`watch`), the list is re-read every few seconds until that app is
 * working or the watch ends.
 */
export const useConnectedAppsWatch = (projectId: string, watch: ConnectWatch | null) =>
  useQuery({
    ...connectedAppsQueryOptions(projectId),
    refetchInterval: (query) => {
      if (!watch) return false;
      const now = Date.now();
      return keepWatching(watchState(watch, query.state.data ?? [], now), watch, now) ? WATCH_POLL_MS : false;
    },
  });
