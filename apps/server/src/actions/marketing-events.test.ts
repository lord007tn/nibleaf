import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({ create: vi.fn(async () => ({ id: 'event-1' })) }));

vi.mock('@nibleaf/database', () => ({ prisma: { platformEvent: { create: database.create } } }));

import { recordMarketingEvent } from './marketing-events';

describe('recordMarketingEvent', () => {
  beforeEach(() => database.create.mockClear());

  it('validates the allowlist again before persistence', async () => {
    await expect(
      recordMarketingEvent({
        event: 'free_tool_started',
        properties: {
          input_mode: 'html',
          page_path: '/tools/rtl-documentation-readiness',
          product: 'nibleaf',
          rubric_version: '0.1.0',
          submitted_html: '<p>private</p>',
          tool_slug: 'rtl-documentation-readiness',
        },
      } as never),
    ).rejects.toThrow();
    expect(database.create).not.toHaveBeenCalled();
  });

  it('persists only parsed allowlisted properties', async () => {
    await recordMarketingEvent({
      event: 'free_tool_cta_clicked',
      properties: {
        destination: 'fixture_corpus',
        placement: 'result_bridge',
        product: 'nibleaf',
        tool_slug: 'rtl-documentation-readiness',
      },
    });

    expect(database.create).toHaveBeenCalledWith({
      data: {
        metadata: {
          destination: 'fixture_corpus',
          placement: 'result_bridge',
          product: 'nibleaf',
          tool_slug: 'rtl-documentation-readiness',
        },
        type: 'free_tool_cta_clicked',
      },
    });
  });
});
