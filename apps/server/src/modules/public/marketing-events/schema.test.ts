import { describe, expect, it } from 'vitest';
import { marketingEventBody } from './schema';

describe('marketing event privacy boundary', () => {
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
});
