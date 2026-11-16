import { useCallback, useState } from 'react';

/**
 * State that belongs to one draft identity (one site's connection form). A new
 * identity replaces it while rendering, so nothing from the previous site
 * shows, not even for one frame, and coming back to a site starts fresh.
 */
export function useIdentityState<S>(identity: string, initial: S) {
  const [state, setState] = useState({ identity, value: initial });
  let current = state;
  if (state.identity !== identity) {
    current = { identity, value: initial };
    setState(current);
  }
  const update = useCallback((next: (previous: S) => S) => setState((previous) => ({ ...previous, value: next(previous.value) })), []);
  return [current.value, update] as const;
}
