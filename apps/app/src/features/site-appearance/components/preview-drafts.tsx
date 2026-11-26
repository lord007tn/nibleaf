import { createContext, type ReactNode, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { AppearanceDrafts } from '../model/preview-config';

/** Where the Appearance page's forms publish their drafts for its one live preview (see `model/preview-config`). */
type Store = {
  get: () => AppearanceDrafts;
  set: <K extends keyof AppearanceDrafts>(key: K, value: AppearanceDrafts[K]) => void;
  subscribe: (listener: () => void) => () => void;
};

function createStore(): Store {
  let drafts: AppearanceDrafts = {};
  const listeners = new Set<() => void>();
  return {
    get: () => drafts,
    set: (key, value) => {
      if (drafts[key] === value) return;
      drafts = { ...drafts };
      if (value === undefined) delete drafts[key];
      else drafts[key] = value;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const DraftsContext = createContext<Store | null>(null);

export function AppearanceDraftsProvider({ children }: { children: ReactNode }) {
  const [store] = useState(createStore);
  return <DraftsContext.Provider value={store}>{children}</DraftsContext.Provider>;
}

/**
 * Publishes a form's draft for the page's preview while the form is mounted.
 * Outside the Appearance page (no provider) it does nothing. Pass a value whose
 * identity changes only when the draft does.
 */
export function usePublishAppearanceDraft<K extends keyof AppearanceDrafts>(key: K, value: AppearanceDrafts[K]) {
  const store = useContext(DraftsContext);
  useEffect(() => {
    store?.set(key, value);
  }, [key, store, value]);
  useEffect(() => () => store?.set(key, undefined), [key, store]);
}

const NO_DRAFTS: AppearanceDrafts = {};
const noop = () => () => undefined;

/** Every published draft, re-rendering when one changes. */
export function useAppearanceDrafts(): AppearanceDrafts {
  const store = useContext(DraftsContext);
  return useSyncExternalStore(store?.subscribe ?? noop, store?.get ?? (() => NO_DRAFTS), store?.get ?? (() => NO_DRAFTS));
}
