import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ArabicDocumentationPlatformsPage } from '@/components/marketing/arabic-seo';

describe('Arabic marketing pages', () => {
  it('renders a disclosed, source-backed six-platform comparison', () => {
    const html = renderToStaticMarkup(<ArabicDocumentationPlatformsPage />);

    expect(html).toContain('الإفصاح: نحن نبني Nibleaf');
    expect(html).toContain('Mintlify');
    expect(html).toContain('GitBook');
    expect(html).toContain('Docusaurus');
    expect(html).toContain('Material for MkDocs');
    expect(html).toContain('Apidog');
    expect(html).toContain('7 نوفمبر 2026');
    expect(html).toContain('https://www.mintlify.com/pricing');
    expect(html).toContain('https://gitbook.com/docs/manage-your-site/customization/extra-configuration');
    expect(html).toContain('https://gitbook.com/docs/manage-your-site/site-structure/variants');
    expect(html).toContain('https://www.gitbook.com/pricing');
    expect(html).toContain('https://docusaurus.io/docs/i18n/introduction');
    expect(html).toContain('https://squidfunk.github.io/mkdocs-material/setup/changing-the-language/');
    expect(html).toContain('https://apidog.com/ar/blog/documentation-tools/');
  });
});
