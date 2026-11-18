let lastPopup: HTMLElement | null = null;

export const observe = {
  changes: [] as Array<{ open: boolean; at: number }>,
  completions: [] as Array<{ open: boolean; at: number; box: ReturnType<typeof snapshot> }>,
  snapshot,
};

function snapshot() {
  const popup = document.querySelector<HTMLElement>('[data-theme-surface="search"]');
  if (popup) lastPopup = popup;
  const element = popup ?? lastPopup;
  if (!element) return null;
  const css = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return {
    at: performance.now(),
    mounted: element.isConnected,
    closed: element.hasAttribute('data-closed'),
    heightVar: element.style.getPropertyValue('--search-height'),
    topVar: element.style.getPropertyValue('--search-top'),
    cssHeight: css.height,
    cssTop: css.top,
    direction: css.direction,
    opacity: css.opacity,
    transform: css.transform,
    bounds: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right },
    animations: element.getAnimations().map((animation) => ({
      state: animation.playState,
      currentTime: Number(animation.currentTime),
      duration: animation.effect?.getComputedTiming().duration,
      progress: animation.effect?.getComputedTiming().progress,
    })),
  };
}
