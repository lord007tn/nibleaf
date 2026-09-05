import { describe, expect, it } from 'vitest';
import { marketingEventBody } from './schema';

describe('marketing event privacy boundary', () => {
  it('accepts grader result attribution without relabeling it as an article', () => {
    const properties = {
      destination: 'signup',
      entry_point: 'free_tool',
      intent: 'first_publish',
      placement: 'result_bridge',
      source: 'rtl_readiness_grader',
    };
    expect(marketingEventBody.safeParse({ event: 'first_publish_cta_clicked', properties }).success).toBe(true);
    expect(
      marketingEventBody.safeParse({ event: 'first_publish_cta_clicked', properties: { ...properties, placement: 'article_bridge' } }).success,
    ).toBe(false);
    expect(marketingEventBody.safeParse({ event: 'first_publish_cta_clicked', properties: { ...properties, source: 'untrusted' } }).success).toBe(
      false,
    );
  });
  it('accepts only fixed first-publish attribution dimensions', () => {
    expect(
      marketingEventBody.safeParse({
        event: 'first_publish_cta_clicked',
        properties: {
          destination: 'signup',
          entry_point: 'organic_content',
          intent: 'first_publish',
          placement: 'article_bridge',
          source: 'mintlify_introduction',
        },
      }).success,
    ).toBe(true);
  });

  it('accepts only the documented free-tool completion dimensions', () => {
    expect(
      marketingEventBody.safeParse({
        event: 'free_tool_completed',
        properties: {
          category_count: 8,
          checks_run: 22,
          checks_unknown: 5,
          product: 'nibleaf',
          result_type: 'strong_evidence',
          rubric_version: '0.1.0',
          tool_slug: 'rtl-documentation-readiness',
        },
      }).success,
    ).toBe(true);
  });

  it.each(['url', 'submitted_html', 'email', 'free_form'])('rejects the extra %s property', (property) => {
    const result = marketingEventBody.safeParse({
      event: 'free_tool_started',
      properties: {
        input_mode: 'html',
        page_path: '/tools/rtl-documentation-readiness',
        product: 'nibleaf',
        rubric_version: '0.1.0',
        tool_slug: 'rtl-documentation-readiness',
        [property]: 'must not be collected',
      },
    });

    expect(result.success).toBe(false);
  });

  it.each(['projectId', 'email', 'url', 'document_text'])('rejects first-publish payloads containing %s', (property) => {
    expect(
      marketingEventBody.safeParse({
        event: 'first_publish_landing_viewed',
        properties: {
          entry_point: 'organic_content',
          intent: 'first_publish',
          source: 'docker_compose_guide',
          [property]: 'private',
        },
      }).success,
    ).toBe(false);
  });
});
