import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GitHubStarLink } from '@/components/cloud-marketing';

describe('GitHubStarLink', () => {
  it('shows an authoritative zero count instead of hiding it', () => {
    const html = renderToStaticMarkup(<GitHubStarLink stars={0} />);
    const fractionalHtml = renderToStaticMarkup(<GitHubStarLink stars={0.5} />);

    expect(html).toContain('href="https://github.com/lord007tn/nibleaf"');
    expect(html).toContain('aria-label="Star Nibleaf on GitHub — 0 stars"');
    expect(html).toContain('Star on GitHub');
    expect(html).toContain('data-github-stars="0"');
    expect(fractionalHtml).toContain('data-github-stars="0"');
  });

  it('rounds large counts like GitHub while retaining the exact accessible label', () => {
    const html = renderToStaticMarkup(<GitHubStarLink stars={1234} />);

    expect(html).toContain('aria-label="Star Nibleaf on GitHub — 1,234 stars"');
    expect(html).toContain('data-github-stars="1234"');
    expect(html).toContain('1.2k');
  });

  it('supports the compact GitHub header control without changing the repository destination', () => {
    const html = renderToStaticMarkup(<GitHubStarLink compact label="GitHub" stars={42} />);

    expect(html).toContain('href="https://github.com/lord007tn/nibleaf"');
    expect(html).toContain('aria-label="Star Nibleaf on GitHub — 42 stars"');
    expect(html).toContain('>GitHub</span>');
    expect(html).toContain('data-github-stars="42"');
  });
});
