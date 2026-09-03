import { describe, expect, it } from 'vitest';
import { BLOG_ENTRIES } from './blog';
import { GUIDE_PILLARS, GUIDES } from './guides';

describe('guide academy registry', () => {
  it('covers the durable question universe without thin duplicate entries', () => {
    expect(GUIDE_PILLARS.map((pillar) => pillar.id)).toEqual([
      'platforms',
      'ownership',
      'migration',
      'arabic',
      'operations',
      'ai',
      'governance',
      'publishing',
    ]);
    expect(new Set(GUIDES.map((guide) => guide.id)).size).toBe(GUIDES.length);
    expect(GUIDES).toHaveLength(13);
    expect(GUIDES.every((guide) => GUIDE_PILLARS.some((pillar) => pillar.id === guide.pillar))).toBe(true);
  });

  it('declares language availability honestly', () => {
    const blogSlugs = new Set(BLOG_ENTRIES.map((entry) => entry.slug));
    for (const guide of GUIDES) {
      expect(guide.language).toBe('bilingual');
      expect(guide.href.ar).not.toBe(guide.href.en);
      for (const href of Object.values(guide.href)) {
        if (!href.startsWith('/blog/')) continue;
        expect(blogSlugs.has(href.slice('/blog/'.length).split('#')[0] ?? ''), `${guide.id} points to missing ${href}`).toBe(true);
      }
    }
  });
});
