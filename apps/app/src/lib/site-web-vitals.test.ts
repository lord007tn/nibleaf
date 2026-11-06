// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectSiteWebVitals } from './site-web-vitals';

afterEach(() => vi.unstubAllGlobals());
describe('native reader web vitals', () => {
  it('collects document metrics, CLS windows and per-interaction latency once on pagehide', () => {
    const callbacks = new Map<string, (list: { getEntries: () => PerformanceEntry[] }) => void>();
    const disconnect = vi.fn();
    class Observer {
      static supportedEntryTypes = ['largest-contentful-paint', 'paint', 'layout-shift', 'event'];
      constructor(readonly callback: (list: { getEntries: () => PerformanceEntry[] }) => void) {}
      observe({ type }: { type: string }) {
        callbacks.set(type, this.callback);
      }
      takeRecords() {
        return [];
      }
      disconnect = disconnect;
    }
    vi.stubGlobal('PerformanceObserver', Observer);
    vi.spyOn(performance, 'getEntriesByType').mockReturnValue([
      { entryType: 'navigation', startTime: 0, responseStart: 180 } as PerformanceNavigationTiming,
    ]);
    const send = vi.fn();
    const cleanup = collectSiteWebVitals(send);
    const emit = (type: string, entries: object[]) =>
      callbacks.get(type)?.({ getEntries: () => entries.map((entry) => ({ entryType: type, ...entry })) as PerformanceEntry[] });
    emit('largest-contentful-paint', [{ startTime: 1400 }]);
    emit('paint', [{ name: 'first-contentful-paint', startTime: 900 }]);
    emit('layout-shift', [
      { startTime: 100, value: 0.05 },
      { startTime: 200, value: 0.04 },
      { startTime: 300, value: 1, hadRecentInput: true },
      { startTime: 3000, value: 0.02 },
    ]);
    emit('event', [
      { interactionId: 1, duration: 80 },
      { interactionId: 1, duration: 120 },
      { interactionId: 2, duration: 70 },
    ]);
    window.dispatchEvent(new Event('pagehide'));
    cleanup();
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({ lcpMs: 1400, fcpMs: 900, clsMilli: 90, inpMs: 120, ttfbMs: 180 });
    expect(disconnect).toHaveBeenCalledTimes(4);
    vi.restoreAllMocks();
  });
  it.each([50, 100])('includes fast interactions in the INP denominator (%i interactions)', (interactionCount) => {
    class Observer {
      static supportedEntryTypes = ['event'];
      constructor(readonly callback: (list: { getEntries: () => PerformanceEntry[] }) => void) {}
      observe() {
        this.callback({ getEntries: () => [{ entryType: 'event', interactionId: 7, duration: 800 }] as unknown as PerformanceEntry[] });
      }
      takeRecords() {
        return [];
      }
      disconnect = vi.fn();
    }
    vi.stubGlobal('PerformanceObserver', Observer);
    vi.stubGlobal('performance', { interactionCount, getEntriesByType: () => [] });
    const send = vi.fn();
    collectSiteWebVitals(send)();
    expect(send).toHaveBeenCalledWith({ inpMs: 0 });
  });
  it('estimates total interaction count from interaction ids without the native count', () => {
    class Observer {
      static supportedEntryTypes = ['event'];
      constructor(readonly callback: (list: { getEntries: () => PerformanceEntry[] }) => void) {}
      observe() {
        this.callback({
          getEntries: () =>
            [
              { entryType: 'event', interactionId: 7, duration: 800 },
              { entryType: 'event', interactionId: 700, duration: 40 },
            ] as unknown as PerformanceEntry[],
        });
      }
      takeRecords() {
        return [];
      }
      disconnect = vi.fn();
    }
    vi.stubGlobal('PerformanceObserver', Observer);
    vi.stubGlobal('performance', { getEntriesByType: () => [] });
    const send = vi.fn();
    collectSiteWebVitals(send)();
    expect(send).toHaveBeenCalledWith({ inpMs: 0 });
  });
  it('does not relabel navigation metrics as a soft-route load', () => {
    const send = vi.fn();
    const cleanup = collectSiteWebVitals(send, false);
    cleanup();
    expect(send).toHaveBeenCalledWith({});
  });
});
