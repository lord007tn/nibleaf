import { useState, useSyncExternalStore } from 'react';

/*
 * Reader controls whose implementation only matters once a reader opens them:
 * the header's language and version menus and the phone drawer. Their Base UI
 * popups bring floating-ui positioning, focus management and scroll locking,
 * about 60 KiB gzip that every published docs page used to load.
 *
 * The page renders a static trigger with the same markup. Its implementation
 * loads on intent (pointer, touch or focus) and then replaces it. A click that
 * comes before the code has loaded opens the control as soon as it loads.
 * Hydrating always renders the static trigger, as the server did.
 */

type IntentModuleStatus = 'idle' | 'loading' | 'failed' | 'loaded';

export interface IntentModule<T> {
  /** Starts the download (or reuses the one in flight). Never rejects: a
   *  failed download resolves `undefined`, reports `failed`, and the next
   *  intent tries again. */
  load: () => Promise<T | undefined>;
  current: () => T | undefined;
  status: () => IntentModuleStatus;
  subscribe: (listener: () => void) => () => void;
}

export function intentModule<T>(importer: () => Promise<T>): IntentModule<T> {
  let value: T | undefined;
  let pending: Promise<T | undefined> | undefined;
  let status: IntentModuleStatus = 'idle';
  const listeners = new Set<() => void>();
  const set = (next: IntentModuleStatus) => {
    status = next;
    for (const listener of listeners) listener();
  };
  return {
    load: () => {
      if (pending) return pending;
      const download: Promise<T | undefined> = importer().then(
        (loaded): T | undefined => {
          value = loaded;
          set('loaded');
          return loaded;
        },
        (): T | undefined => {
          pending = undefined;
          // Said, not swallowed: the static trigger tells the reader and the
          // next intent tries again.
          set('failed');
          return value;
        },
      );
      pending = download;
      set('loading');
      return download;
    },
    current: () => value,
    status: () => status,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const notLoaded = () => undefined;
const notStarted = (): IntentModuleStatus => 'idle';

/** How the implementation starts once it replaces the static trigger. */
export interface IntentStart {
  /** The reader already clicked the static trigger. */
  defaultOpen: boolean;
  /** The static trigger had focus, so the real one takes it over. */
  focusTrigger: boolean;
}

/**
 * The loaded implementation (never while hydrating), the handlers to spread on
 * the static trigger, and how the implementation should start.
 */
export function useIntentModule<T>(module: IntentModule<T>) {
  const loaded = useSyncExternalStore(module.subscribe, module.current, notLoaded);
  const status = useSyncExternalStore(module.subscribe, module.status, notStarted);
  const [defaultOpen, setDefaultOpen] = useState(false);
  const [focusTrigger, setFocusTrigger] = useState(false);
  const preload = () => {
    void module.load();
  };
  const start: IntentStart = { defaultOpen, focusTrigger };
  return {
    loaded,
    start,
    /** The reader opened the control and its code didn't arrive: say so
     *  (`controlLoadFailed`); selecting the trigger again retries. */
    failed: defaultOpen && status === 'failed',
    trigger: {
      // Busy only once the reader asked for it, not while it preloads on hover.
      'aria-busy': defaultOpen && status === 'loading' ? true : undefined,
      onPointerEnter: preload,
      onTouchStart: preload,
      onFocus: () => {
        setFocusTrigger(true);
        preload();
      },
      onBlur: () => setFocusTrigger(false),
      onClick: () => {
        setDefaultOpen(true);
        preload();
      },
    },
  };
}
