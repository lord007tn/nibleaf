// @vitest-environment jsdom

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CloudPage, GitHubStarLink, LandingPage } from '@/components/cloud-marketing';
import { ArabicLandingPage } from '@/components/marketing/arabic-seo';

describe('marketing calls to action', () => {
  it('keeps the self-hosting guide without exposing an inline installer or Markdown source controls', () => {
    const landing = renderToStaticMarkup(<LandingPage />);
    const arabic = renderToStaticMarkup(<ArabicLandingPage />);
    expect(landing).toContain('aria-label="Read the self-hosting guide"');
    for (const html of [landing, arabic]) {
      expect(html).toContain('href="/self-hosting"');
      expect(html).not.toContain('actual##');
      expect(html).not.toContain('nibleaf-install.sh');
      expect(html).not.toMatch(/View Markdown|Copy Markdown|عرض Markdown|نسخ Markdown/);
    }
  });
  it('uses destination-focused labels instead of generic prompts', () => {
    const landing = renderToStaticMarkup(<LandingPage stars={42} />);
    const cloud = renderToStaticMarkup(<CloudPage stars={42} />);

    expect(landing).toContain('Create account');
    expect(landing).toContain('Create free account');
    expect(landing).toContain('Compare options');
    expect(cloud).toContain('Create free account');
    expect(`${landing}${cloud}`).not.toContain('Get started');
    expect(`${landing}${cloud}`).not.toContain('Learn more');
  });
});

describe('GitHubStarLink', () => {
  it('keeps the repository link without presenting a cold or failed lookup as zero stars', () => {
    const html = renderToStaticMarkup(<GitHubStarLink stars={0} />);
    const fractionalHtml = renderToStaticMarkup(<GitHubStarLink stars={0.5} />);

    expect(html).toContain('href="https://github.com/lord007tn/nibleaf"');
    expect(html).toContain('aria-label="Star Nibleaf on GitHub"');
    expect(html).toContain('Star on GitHub');
    expect(html).not.toContain('data-github-stars');
    expect(fractionalHtml).not.toContain('data-github-stars');
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
