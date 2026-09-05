import { z } from 'zod';
import { sendMarketingAnalyticsEvent } from './marketing-analytics';

export type FirstPublishSource = 'docker_compose_guide' | 'mintlify_introduction' | 'rtl_readiness_grader';
export type MarketingEventName =
  | 'first_publish_cta_clicked'
  | 'first_publish_landing_viewed'
  | 'free_tool_started'
  | 'free_tool_completed'
  | 'free_tool_cta_clicked';

type MarketingEventProperties = {
  first_publish_landing_viewed: {
    entry_point: 'organic_content' | 'free_tool';
    intent: 'first_publish';
    source: FirstPublishSource;
  };
  first_publish_cta_clicked: {
    destination: 'signup';
    entry_point: 'organic_content' | 'free_tool';
    intent: 'first_publish';
    placement: 'article_bridge' | 'result_bridge';
    source: FirstPublishSource;
  };
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

function allowlistedProperties<E extends MarketingEventName>(event: E, value: MarketingEventProperties[E]): boolean {
  if (event === 'first_publish_landing_viewed') {
    return z
      .strictObject({
        entry_point: z.enum(['organic_content', 'free_tool']),
        intent: z.literal('first_publish'),
        source: z.enum(['docker_compose_guide', 'mintlify_introduction', 'rtl_readiness_grader']),
      })
      .refine((p) => p.entry_point === (p.source === 'rtl_readiness_grader' ? 'free_tool' : 'organic_content'))
      .safeParse(value).success;
  }
  if (event === 'first_publish_cta_clicked') {
    return z
      .strictObject({
        destination: z.literal('signup'),
        entry_point: z.enum(['organic_content', 'free_tool']),
        intent: z.literal('first_publish'),
        placement: z.enum(['article_bridge', 'result_bridge']),
        source: z.enum(['docker_compose_guide', 'mintlify_introduction', 'rtl_readiness_grader']),
      })
      .refine(
        (p) =>
          p.entry_point === (p.source === 'rtl_readiness_grader' ? 'free_tool' : 'organic_content') &&
          p.placement === (p.source === 'rtl_readiness_grader' ? 'result_bridge' : 'article_bridge'),
      )
      .safeParse(value).success;
  }
  if (event === 'free_tool_started') {
    return z
      .strictObject({
        input_mode: z.literal('html'),
        page_path: z.literal('/tools/rtl-documentation-readiness'),
        product: z.literal('nibleaf'),
        rubric_version: z.string().regex(/^\d+\.\d+\.\d+$/u),
        tool_slug: z.literal('rtl-documentation-readiness'),
      })
      .safeParse(value).success;
  }
  if (event === 'free_tool_completed') {
    return z
      .strictObject({
        category_count: z.number().int().min(1).max(20),
        checks_run: z.number().int().min(0).max(100),
        checks_unknown: z.number().int().min(0).max(100),
        product: z.literal('nibleaf'),
        result_type: z.enum(['strong_evidence', 'work_remaining', 'material_gaps', 'insufficient_evidence']),
        rubric_version: z.string().regex(/^\d+\.\d+\.\d+$/u),
        tool_slug: z.literal('rtl-documentation-readiness'),
      })
      .safeParse(value).success;
  }
  return z
    .strictObject({
      destination: z.enum(['sample_project_signup', 'fixture_corpus']),
      placement: z.literal('result_bridge'),
      product: z.literal('nibleaf'),
      tool_slug: z.literal('rtl-documentation-readiness'),
    })
    .safeParse(value).success;
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
