import { DirectionProvider as BaseDirectionProvider } from '@base-ui/react/direction-provider';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';

type Direction = 'ltr' | 'rtl';
const STORAGE_KEY = 'nibleaf.direction';

interface DirectionContextValue {
  direction: Direction;
  setDirection: (dir: Direction) => void;
  toggleDirection: () => void;
}

const DirectionContext = createContext<DirectionContextValue | null>(null);

/**
 * RTL-aware direction provider. Wraps the tree in Base UI's DirectionProvider
 * (so popovers/menus mirror correctly) and keeps `<html dir>` in sync. Toggle
 * via the settings → appearance control or `useDirection()`.
 */
export function DirectionProvider({ children }: { children: ReactNode }) {
  // Match the server on the first client render. LocaleProvider applies the
  // persisted language's direction after its catalog has loaded.
  const [direction, setDirectionState] = useState<Direction>('ltr');

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dir = direction;
    }
  }, [direction]);

  const setDirection = useCallback((dir: Direction) => {
    setDirectionState(dir);
    try {
      window.localStorage.setItem(STORAGE_KEY, dir);
    } catch {
      // ignore persistence failures (private mode)
    }
  }, []);

  const toggleDirection = useCallback(() => setDirection(direction === 'rtl' ? 'ltr' : 'rtl'), [direction, setDirection]);

  return (
    <DirectionContext value={{ direction, setDirection, toggleDirection }}>
      <BaseDirectionProvider direction={direction}>{children}</BaseDirectionProvider>
    </DirectionContext>
  );
}

export function useDirection(): DirectionContextValue {
  const ctx = useContext(DirectionContext);
  if (!ctx) {
    throw new Error('useDirection must be used within a DirectionProvider');
  }
  return ctx;
}
