import { sendMarketingAnalyticsEvent } from './marketing-analytics';

export type MarketingEventName = 'free_tool_started' | 'free_tool_completed' | 'free_tool_cta_clicked';

type MarketingEventProperties = {
  free_tool_started: {
    input_mode: 'html';
    page_path: '/tools/rtl-documentation-readiness';
    product: 'nibleaf';
    rubric_version: string;
    tool_slug: 'rtl-documentation-readiness';
  };
  free_tool_completed: {
    category_count: number;
    checks_run: number;
    checks_unknown: number;
    product: 'nibleaf';
    result_type: 'strong_evidence' | 'work_remaining' | 'material_gaps' | 'insufficient_evidence';
    rubric_version: string;
    tool_slug: 'rtl-documentation-readiness';
  };
  free_tool_cta_clicked: {
    destination: 'sample_project_signup' | 'fixture_corpus';
    placement: 'result_bridge';
    product: 'nibleaf';
    tool_slug: 'rtl-documentation-readiness';
  };
};

const exactKeys = (value: object, keys: string[]) => {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === [...keys].sort()[index]);
};

const validVersion = (value: unknown) => typeof value === 'string' && /^\d+\.\d+\.\d+$/u.test(value);

function allowlistedProperties<E extends MarketingEventName>(event: E, value: MarketingEventProperties[E]): boolean {
  if (!value || typeof value !== 'object') return false;
  if (value.product !== 'nibleaf' || value.tool_slug !== 'rtl-documentation-readiness') return false;
  if (event === 'free_tool_started') {
    const properties = value as MarketingEventProperties['free_tool_started'];
    return (
      exactKeys(properties, ['input_mode', 'page_path', 'product', 'rubric_version', 'tool_slug']) &&
      properties.input_mode === 'html' &&
      properties.page_path === '/tools/rtl-documentation-readiness' &&
      validVersion(properties.rubric_version)
    );
  }
  if (event === 'free_tool_completed') {
    const properties = value as MarketingEventProperties['free_tool_completed'];
    return (
      exactKeys(properties, ['category_count', 'checks_run', 'checks_unknown', 'product', 'result_type', 'rubric_version', 'tool_slug']) &&
      Number.isInteger(properties.category_count) &&
      properties.category_count >= 1 &&
      properties.category_count <= 20 &&
      Number.isInteger(properties.checks_run) &&
      properties.checks_run >= 0 &&
      properties.checks_run <= 100 &&
      Number.isInteger(properties.checks_unknown) &&
      properties.checks_unknown >= 0 &&
      properties.checks_unknown <= 100 &&
      ['strong_evidence', 'work_remaining', 'material_gaps', 'insufficient_evidence'].includes(properties.result_type) &&
      validVersion(properties.rubric_version)
    );
  }
  const properties = value as MarketingEventProperties['free_tool_cta_clicked'];
  return (
    exactKeys(properties, ['destination', 'placement', 'product', 'tool_slug']) &&
    ['sample_project_signup', 'fixture_corpus'].includes(properties.destination) &&
    properties.placement === 'result_bridge'
  );
}

/** Privacy-safe marketing events. The caller must never include submitted HTML,
 * a tested URL, personal data, or free-form text. Delivery is best effort and
 * never blocks the tool result or navigation. */
export function trackMarketingEvent<E extends MarketingEventName>(event: E, properties: MarketingEventProperties[E]): void {
  if (typeof window === 'undefined' || !allowlistedProperties(event, properties)) return;
  sendMarketingAnalyticsEvent(event, properties);
  void fetch('/api/public/marketing-events', {
    body: JSON.stringify({ event, properties }),
    headers: { 'content-type': 'application/json' },
    keepalive: true,
    method: 'POST',
  }).catch(() => undefined);
}
