import { useEffect, useRef } from 'react';

/**
 * Whether the component is still on screen. A request that answers after the
 * section closed (the editor remounts it per site) must not toast or download
 * anything over whatever is shown now.
 */
export function useMounted() {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
}
