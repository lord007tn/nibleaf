import { useSyncExternalStore } from 'react';

/** From this width the Ask AI panel docks beside the article instead of
 *  covering it (PUB-003). Matches `--chat-dock-min` in styles.css. */
const CHAT_DOCK_QUERY = '(min-width: 80rem)';

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(CHAT_DOCK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

/** Whether the panel docks: a column beside the article, with no backdrop, no
 *  scroll lock and no focus trap, so the reader can read, scroll, copy and
 *  follow a cited section while the answer stays open. The server renders the
 *  panel closed, so it never needs to know. */
export function useDockedChat(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(CHAT_DOCK_QUERY).matches,
    () => false,
  );
}
