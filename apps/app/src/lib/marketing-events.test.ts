import { beforeEach, describe, expect, it, vi } from 'vitest';
import { trackMarketingEvent } from './marketing-events';

describe('trackMarketingEvent', () => {
  const request = vi.fn(async () => new Response(null, { status: 200 }));

  beforeEach(() => {
    request.mockClear();
    vi.stubGlobal('fetch', request);
    vi.stubGlobal('window', { location: new URL('https://nibleaf.test/tools/rtl-documentation-readiness') });
  });

  it('sends an exact allowlisted payload', () => {
    trackMarketingEvent('free_tool_started', {
      input_mode: 'html',
      page_path: '/tools/rtl-documentation-readiness',
      product: 'nibleaf',
      rubric_version: '0.1.0',
      tool_slug: 'rtl-documentation-readiness',
    });

    expect(request).toHaveBeenCalledOnce();
  });

  it('does not transmit an object containing a disallowed property', () => {
    trackMarketingEvent('free_tool_started', {
      input_mode: 'html',
      page_path: '/tools/rtl-documentation-readiness',
      product: 'nibleaf',
      rubric_version: '0.1.0',
      submitted_html: '<p>private</p>',
      tool_slug: 'rtl-documentation-readiness',
    } as never);

    expect(request).not.toHaveBeenCalled();
  });
});
