import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ArabicShell } from '@/components/marketing/arabic-seo';
import { GuidesHub } from '@/components/marketing/guides';

describe('GuidesHub locale shell', () => {
  it('provides visible reciprocal locale anchors and an Arabic shell discovery link', () => {
    expect(renderToStaticMarkup(<GuidesHub locale="en" />)).toMatch(/<a[^>]+href="\/ar\/guides"[^>]+hrefLang="ar"/);
    expect(renderToStaticMarkup(<GuidesHub locale="ar" />)).toMatch(/<a[^>]+href="\/guides"[^>]+hrefLang="en"/);
    expect(renderToStaticMarkup(<ArabicShell englishHref="/">Content</ArabicShell>)).toContain('href="/ar/guides"');
  });
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
