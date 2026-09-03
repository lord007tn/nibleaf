import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GuidesHub } from '@/components/marketing/guides';

describe('GuidesHub locale shell', () => {
  it('renders Arabic guides in localized RTL chrome with the reciprocal English owner', () => {
    const html = renderToStaticMarkup(<GuidesHub locale="ar" />);

    expect(html).toContain('dir="rtl"');
    expect(html).toContain('lang="ar"');
    expect(html).toContain('aria-label="التنقل العربي"');
    expect(html).toContain('href="/ar/documentation-platforms"');
    expect(html).toContain('href="/guides"');
    expect(html).not.toContain('aria-label="Primary navigation"');
  });
});
