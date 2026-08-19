export type MarketingEventName = 'free_tool_started' | 'free_tool_completed' | 'free_tool_cta_clicked';

/** Privacy-safe marketing events. The caller must never include submitted HTML,
 * a tested URL, personal data, or free-form text. Delivery is best effort and
 * never blocks the tool result or navigation. */
export function trackMarketingEvent(event: MarketingEventName, properties: Record<string, string | number>): void {
  if (typeof window === 'undefined') return;
  void fetch('/api/public/marketing-events', {
    body: JSON.stringify({ event, properties }),
    headers: { 'content-type': 'application/json' },
    keepalive: true,
    method: 'POST',
  }).catch(() => undefined);
}
