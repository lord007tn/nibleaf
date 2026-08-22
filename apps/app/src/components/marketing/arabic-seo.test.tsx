import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ArabicDocumentationPlatformsPage, ArabicLandingPage } from '@/components/marketing/arabic-seo';

describe('Arabic marketing pages', () => {
  it('renders a complete RTL landing journey with a localized primary action', () => {
    const html = renderToStaticMarkup(<ArabicLandingPage />);

    expect(html).toContain('dir="rtl"');
    expect(html).toContain('اكتب وثائق المنتج بالعربية');
    expect(html).toContain('href="/sign-up"');
    expect(html).toContain('href="/ar/documentation-platforms"');
    expect(html).toContain('lang=&quot;ar&quot;');
  });

  it('renders a disclosed, source-backed six-platform comparison', () => {
    const html = renderToStaticMarkup(<ArabicDocumentationPlatformsPage />);

    expect(html).toContain('الإفصاح: نحن نبني Nibleaf');
    expect(html).toContain('Mintlify');
    expect(html).toContain('GitBook');
    expect(html).toContain('Docusaurus');
    expect(html).toContain('Material for MkDocs');
    expect(html).toContain('Apidog');
    expect(html).toContain('22 أغسطس 2026');
    expect(html.match(/المصدر الرسمي/g)?.length).toBeGreaterThanOrEqual(5);
  });
});
