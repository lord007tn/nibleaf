import { type CSSProperties, useEffect, useState } from 'react';
/** Keep the composer within the visual viewport when a mobile keyboard opens. */
export function useChatViewport(open: boolean): CSSProperties {
  const [viewport, setViewport] = useState<CSSProperties>({});
  useEffect(() => {
    const visual = window.visualViewport;
    if (!open || !visual) return;
    const update = () => setViewport({ '--chat-height': `${visual.height}px`, '--chat-top': `${visual.offsetTop}px` } as CSSProperties);
    update();
    visual.addEventListener('resize', update);
    visual.addEventListener('scroll', update);
    return () => {
      visual.removeEventListener('resize', update);
      visual.removeEventListener('scroll', update);
    };
  }, [open]);
  return viewport;
}
