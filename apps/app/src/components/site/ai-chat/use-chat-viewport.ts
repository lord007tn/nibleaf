import type { CSSProperties } from 'react';
import { useVisualViewport } from '@/components/site/use-visual-viewport';

/** Keep the composer within the visual viewport when a mobile keyboard opens. */
export function useChatViewport(open: boolean): CSSProperties {
  const box = useVisualViewport(open);
  return box ? ({ '--chat-height': `${box.height}px`, '--chat-top': `${box.top}px` } as CSSProperties) : {};
}
