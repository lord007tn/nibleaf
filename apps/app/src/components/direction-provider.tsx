import { DirectionProvider as BaseDirectionProvider } from '@base-ui/react/direction-provider';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';

type Direction = 'ltr' | 'rtl';
const STORAGE_KEY = 'midad.direction';

interface DirectionContextValue {
  direction: Direction;
  setDirection: (dir: Direction) => void;
  toggleDirection: () => void;
}

const DirectionContext = createContext<DirectionContextValue | null>(null);

const readStored = (): Direction => {
  if (typeof window === 'undefined') {
    return 'ltr';
  }
  return window.localStorage.getItem(STORAGE_KEY) === 'rtl' ? 'rtl' : 'ltr';
};

/**
 * RTL-aware direction provider. Wraps the tree in Base UI's DirectionProvider
 * (so popovers/menus mirror correctly) and keeps `<html dir>` in sync. Toggle
 * via the settings → appearance control or `useDirection()`.
 */
export function DirectionProvider({ children }: { children: ReactNode }) {
  const [direction, setDirectionState] = useState<Direction>(() => readStored());

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

  const toggleDirection = useCallback(() => setDirection(readStored() === 'rtl' ? 'ltr' : 'rtl'), [setDirection]);

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
