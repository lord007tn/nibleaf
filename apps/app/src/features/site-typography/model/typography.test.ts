import { describe, expect, it } from 'vitest';
import {
  activePreset,
  applyPreset,
  fontOptions,
  PRESETS,
  previewStyle,
  TYPOGRAPHY_DEFAULTS,
  type TypographyValues,
  typographyUpdate,
  typographyValues,
} from './typography';

const STORED: TypographyValues = {
  headingFont: 'Inter',
  bodyFont: 'Source Sans 3',
  codeFont: 'Fira Code',
  baseSize: '15',
  leading: '1.6',
  flow: '1',
};

describe('typographyValues', () => {
  it('reads the stored values as they are', () => {
    expect(typographyValues({ typography: STORED })).toEqual(STORED);
  });

  it('reads a site that never set typography with the defaults', () => {
    expect(typographyValues(undefined)).toEqual(TYPOGRAPHY_DEFAULTS);
    expect(typographyValues({ typography: null })).toEqual(TYPOGRAPHY_DEFAULTS);
    expect(TYPOGRAPHY_DEFAULTS).toEqual({
      headingFont: 'Geist',
      bodyFont: 'Geist',
      codeFont: 'Geist Mono',
      baseSize: '16',
      leading: '1.75',
      flow: '1.25',
    });
  });

  it('keeps a custom font name the site stored, trimmed; a blank one reads as the default', () => {
    const values = typographyValues({ typography: { headingFont: ' Merriweather ', bodyFont: '   ', codeFont: null } });
    expect(values).toMatchObject({ headingFont: 'Merriweather', bodyFont: 'Geist', codeFont: 'Geist Mono' });
  });

  it('reads a rhythm step outside the schema as the default, and each field on its own', () => {
    expect(typographyValues({ typography: { baseSize: '20', leading: '1.9', flow: 'wide' } })).toMatchObject({
      baseSize: '16',
      leading: '1.9',
      flow: '1.25',
    });
  });
});

describe('fontOptions', () => {
  it('lists every catalog font for each picker', () => {
    expect(fontOptions('headingFont', 'Geist')).toEqual(['Geist', 'Inter', 'Söhne', 'IBM Plex Sans', 'System UI']);
    expect(fontOptions('bodyFont', 'Geist')).toEqual(['Geist', 'Inter', 'Source Sans 3', 'System UI']);
    expect(fontOptions('codeFont', 'Geist Mono')).toEqual(['Geist Mono', 'JetBrains Mono', 'IBM Plex Mono', 'Fira Code']);
  });

  it("adds the site's own font after the catalog, once", () => {
    expect(fontOptions('bodyFont', 'Merriweather')).toEqual(['Geist', 'Inter', 'Source Sans 3', 'System UI', 'Merriweather']);
    expect(fontOptions('bodyFont', 'Inter')).not.toContain('Merriweather');
  });
});

describe('presets', () => {
  it('keeps the four reading styles and their triples', () => {
    expect(PRESETS).toEqual({
      default: { baseSize: '16', leading: '1.75', flow: '1.25' },
      compact: { baseSize: '15', leading: '1.6', flow: '1' },
      relaxed: { baseSize: '16', leading: '1.9', flow: '1.5' },
      article: { baseSize: '17', leading: '2', flow: '1.5' },
    });
  });

  it('changes only the rhythm triple, never a font', () => {
    const custom = { ...STORED, headingFont: 'Merriweather' };
    expect(applyPreset(custom, 'article')).toEqual({ ...custom, baseSize: '17', leading: '2', flow: '1.5' });
  });

  it('is active only while all three values match it', () => {
    expect(activePreset(TYPOGRAPHY_DEFAULTS)).toBe('default');
    expect(activePreset(STORED)).toBe('compact');
    const relaxed = applyPreset(STORED, 'relaxed');
    expect(activePreset(relaxed)).toBe('relaxed');
    // One step off the preset: no preset is active…
    expect(activePreset({ ...relaxed, leading: '2' })).toBeUndefined();
    // …unless the edit lands on another preset's triple.
    expect(activePreset({ ...relaxed, leading: '1.75', flow: '1.25' })).toBe('default');
  });
});

describe('typographyUpdate', () => {
  it('sends only what changed', () => {
    expect(typographyUpdate(STORED, STORED)).toEqual({});
    expect(typographyUpdate(STORED, { ...STORED, codeFont: 'JetBrains Mono', leading: '1.75' })).toEqual({
      codeFont: 'JetBrains Mono',
      leading: '1.75',
    });
  });

  it('sends a preset as its three values, never its name', () => {
    const update = typographyUpdate(STORED, applyPreset(STORED, 'article'));
    expect(update).toEqual({ baseSize: '17', leading: '2', flow: '1.5' });
    expect(JSON.stringify(update)).not.toContain('article');
  });
});

describe('previewStyle', () => {
  it('sets the typeset variables from the values', () => {
    expect(previewStyle({ ...STORED, headingFont: 'Söhne' })).toEqual({
      fontSize: '15px',
      '--typeset-leading': '1.6',
      '--typeset-flow': '1em',
      '--typeset-font-body': "'Source Sans 3', var(--font-sans, system-ui, sans-serif)",
      '--typeset-font-heading': "'Söhne', var(--font-sans, sans-serif)",
      '--typeset-font-mono': "'Fira Code', var(--font-mono, monospace)",
    });
  });
});
