interface Vitals {
  lcpMs?: number;
  inpMs?: number;
  clsMilli?: number;
  fcpMs?: number;
  ttfbMs?: number;
}
type VitalEntry = PerformanceEntry & {
  value?: number;
  hadRecentInput?: boolean;
  interactionId?: number;
  responseStart?: number;
  requestStart?: number;
};

/** One report on first hide/pagehide/route cleanup; observers are disconnected.
 * Unsupported metrics stay absent. CLS uses session windows, and INP uses the
 * 98th percentile of each interaction's longest event rather than event count. */
export const collectSiteWebVitals = (send: (vitals: Vitals) => void, documentLoad = true): (() => void) => {
  const vitals: Vitals = {};
  const observers: PerformanceObserver[] = [];
  const interactions = new Map<number, number>();
  let sent = false;
  let inpObserved = false;
  let minInteractionId = Number.POSITIVE_INFINITY;
  let maxInteractionId = 0;
  let clsWindowStart = 0;
  let clsLastShift = 0;
  let clsWindow = 0;
  let clsMax = 0;
  const consume = (entries: PerformanceEntry[]) => {
    for (const entry of entries as VitalEntry[]) {
      if (entry.entryType === 'largest-contentful-paint') vitals.lcpMs = Math.round(entry.startTime);
      if (entry.entryType === 'paint' && entry.name === 'first-contentful-paint') vitals.fcpMs = Math.round(entry.startTime);
      if (entry.entryType === 'layout-shift' && !entry.hadRecentInput) {
        if (entry.startTime - clsLastShift > 1000 || entry.startTime - clsWindowStart > 5000) {
          clsWindowStart = entry.startTime;
          clsWindow = 0;
        }
        clsLastShift = entry.startTime;
        clsWindow += entry.value ?? 0;
        clsMax = Math.max(clsMax, clsWindow);
        vitals.clsMilli = Math.round(clsMax * 1000);
      }
      if ((entry.entryType === 'event' || entry.entryType === 'first-input') && entry.interactionId) {
        minInteractionId = Math.min(minInteractionId, entry.interactionId);
        maxInteractionId = Math.max(maxInteractionId, entry.interactionId);
        interactions.set(entry.interactionId, Math.max(interactions.get(entry.interactionId) ?? 0, entry.duration));
        // Only the ten longest interactions can affect the p98 estimate.
        if (interactions.size > 10) {
          const shortest = [...interactions].sort((a, b) => a[1] - b[1])[0];
          if (shortest) interactions.delete(shortest[0]);
        }
      }
    }
  };
  if (documentLoad && typeof PerformanceObserver !== 'undefined') {
    for (const type of ['largest-contentful-paint', 'paint', 'layout-shift', 'event', 'first-input']) {
      try {
        if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
        const observer = new PerformanceObserver((list) => consume(list.getEntries()));
        observer.observe({ type, buffered: true, ...(type === 'event' ? { durationThreshold: 16 } : {}) });
        observers.push(observer);
        if (type === 'event') inpObserved = true;
        if (type === 'layout-shift') vitals.clsMilli = 0;
      } catch {
        /* Older engines may reject a supported type's options. */
      }
    }
    const navigation = performance.getEntriesByType('navigation')[0] as VitalEntry | undefined;
    if (navigation?.responseStart !== undefined && navigation.responseStart > 0)
      vitals.ttfbMs = Math.round(navigation.responseStart - navigation.startTime);
  }
  const report = () => {
    if (sent) return;
    sent = true;
    for (const observer of observers) {
      consume(observer.takeRecords());
      observer.disconnect();
    }
    const latencies = [...interactions.values()].sort((a, b) => b - a);
    // Chromium interaction ids advance by seven, including interactions below
    // the event observer threshold. Prefer the browser's exact document count.
    const count =
      (performance as Performance & { interactionCount?: number }).interactionCount ??
      (maxInteractionId ? (maxInteractionId - minInteractionId) / 7 + 1 : 0);
    if (inpObserved && count > 0) vitals.inpMs = Math.round(latencies[Math.min(9, Math.floor(count / 50))] ?? 0);
    try {
      send(vitals);
    } catch {
      /* Analytics must never interrupt navigation. */
    }
  };
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') report();
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', report);
  return () => {
    report();
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', report);
  };
};
