import { contrastRatio, resolveTheme, THEME_PRESET_IDS } from '@nibleaf/shared/themes';
import { describe, expect, it } from 'vitest';
import { accentTextAdjustments } from './accent-text-adjustments';

const adjustments = (config: Parameters<typeof resolveTheme>[0]) =>
  accentTextAdjustments(resolveTheme(config, { authoredAccent: true }), resolveTheme(config));

describe('accentTextAdjustments', () => {
  it('reports an authored accent the published site shades to read as text', () => {
    // docs.nibleaf.com's brand colour: 3.94:1 on the light canvas as authored.
    const config = { theme: { preset: 'harbor' as const, colors: { light: { accent: '#B96A3D' } } } };
    const { light } = resolveTheme(config).colors;
    expect(adjustments(config)).toEqual([
      {
        mode: 'light',
        from: '#b96a3d',
        fromRatio: contrastRatio('#b96a3d', light.canvas),
        to: light.accent,
        toRatio: contrastRatio(light.accent, light.canvas),
      },
    ]);
  });

  it('reports nothing for presets, which already pass as authored', () => {
    for (const id of THEME_PRESET_IDS) expect(adjustments({ theme: { preset: id } })).toEqual([]);
  });
});
