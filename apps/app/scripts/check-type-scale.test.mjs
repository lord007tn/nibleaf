import { describe, expect, it } from 'vitest';
import { compareTypeScale, countArbitraryTextSizes } from './check-type-scale.mjs';

describe('arbitrary text size counter', () => {
  it('counts integer and decimal px/rem sizes, including responsive variants', () => {
    expect(countArbitraryTextSizes('text-[13px] md:text-[13.5px] text-[1rem] text-[0.875rem]')).toBe(4);
  });

  it('ignores scale tokens, tracking and other arbitrary values', () => {
    expect(countArbitraryTextSizes('text-sm tracking-[0.1rem] text-[var(--size)] text-[red] text-[12em]')).toBe(0);
    expect(countArbitraryTextSizes('')).toBe(0);
  });
});

describe('type scale baseline ratchet', () => {
  const section = 'src/components/project-settings/general-section.tsx';
  const added = 'src/components/settings/new-section.tsx';

  it('accepts unchanged or lowered counts and only lowers the next baseline', () => {
    expect(compareTypeScale({ [section]: 2 }, { [section]: 3 })).toEqual({ violations: [], nextBaseline: { [section]: 2 } });
    expect(compareTypeScale({ [section]: 3 }, { [section]: 3 })).toEqual({ violations: [], nextBaseline: { [section]: 3 } });
  });

  it('rejects increases without raising the baseline', () => {
    expect(compareTypeScale({ [section]: 4 }, { [section]: 3 })).toEqual({
      violations: [`${section}: 4 arbitrary text sizes (baseline 3)`],
      nextBaseline: { [section]: 3 },
    });
  });

  it('allows new zero-count files, rejects new violations and never adds their counts', () => {
    expect(compareTypeScale({ [added]: 0 }, {})).toEqual({ violations: [], nextBaseline: {} });
    expect(compareTypeScale({ [added]: 1 }, {})).toEqual({
      violations: [`${added}: 1 arbitrary text sizes (baseline 0)`],
      nextBaseline: {},
    });
  });

  it('drops zero-count and removed files, keeping future regressions at zero', () => {
    expect(compareTypeScale({ [section]: 0 }, { [section]: 3, [added]: 2 })).toEqual({ violations: [], nextBaseline: {} });
  });

  it('rejects arbitrary sizes in features even if a baseline allows them', () => {
    const feature = 'src/features/site-general/components/general-section.tsx';
    expect(compareTypeScale({ [feature]: 1 }, { [feature]: 1 }).violations).toEqual([`${feature}: 1 arbitrary text sizes (features must have zero)`]);
    expect(compareTypeScale({ [feature]: 0 }, {})).toEqual({ violations: [], nextBaseline: {} });
  });
});
