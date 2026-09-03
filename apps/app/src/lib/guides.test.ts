import { describe, expect, it } from 'vitest';
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
    expect(GUIDES).toHaveLength(9);
    expect(GUIDES.every((guide) => GUIDE_PILLARS.some((pillar) => pillar.id === guide.pillar))).toBe(true);
  });

  it('declares language availability honestly', () => {
    for (const guide of GUIDES) {
      if (guide.language === 'bilingual') expect(guide.href.ar).not.toBe(guide.href.en);
      if (guide.language === 'en') expect(guide.href.ar).toBe(guide.href.en);
    }
  });
});
