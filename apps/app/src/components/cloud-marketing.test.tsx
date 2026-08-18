import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { GitHubStarLink } from '@/components/cloud-marketing';

describe('GitHubStarLink', () => {
  it('offers a truthful count-free action when the repository has no stars or GitHub is unavailable', () => {
    const html = renderToStaticMarkup(<GitHubStarLink stars={0} />);

    expect(html).toContain('href="https://github.com/lord007tn/nibleaf"');
    expect(html).toContain('aria-label="Star Nibleaf on GitHub"');
    expect(html).toContain('Star on GitHub');
    expect(html).not.toContain('data-github-stars');
  });

  it('renders an authoritative positive count with an accessible label', () => {
    const html = renderToStaticMarkup(<GitHubStarLink stars={1234} />);

    expect(html).toContain('aria-label="Star Nibleaf on GitHub — 1,234 stars"');
    expect(html).toContain('data-github-stars="1234"');
    expect(html).toContain('1,234');
  });
});
