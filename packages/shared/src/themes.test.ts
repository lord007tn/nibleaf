import { describe, expect, it } from 'vitest';
import {
  ACCENT_TEXT_CONTRAST,
  accentTextAdjustments,
  applyThemeTemplateConfig,
  canonicalThemeTemplateJson,
  contrastRatio,
  inspectThemeTemplateInput,
  previewThemeConfigChanges,
  readableAccentText,
  readableOnBackground,
  resolveTheme,
  safeThemeFontFamily,
  safeThemeHex,
  THEME_PRESET_IDS,
  THEME_PRESETS,
  themeContrastIssues,
  themeOwnedConfig,
  themeTemplateFromConfig,
} from './themes';

describe('readableOnBackground', () => {
  it('reaches the target on a mid-tone background by trying the other side too', () => {
    // Towards white never reaches 4.7:1 on #999999; towards black does.
    const color = readableOnBackground('#303030', '#999999', 4.7);
    expect(contrastRatio(color, '#999999')).toBeGreaterThanOrEqual(4.7);
    expect(contrastRatio(color, '#999999')).toBeGreaterThan(contrastRatio('#303030', '#999999'));
  });

  it('keeps a color that already passes, and otherwise falls back to the more readable of black and white', () => {
    expect(readableOnBackground('#5b6577', '#ffffff', 4.5)).toBe('#5b6577');
    expect(readableOnBackground('#777777', '#777777', 21)).toBe('#000000');
  });
});

describe('documentation themes', () => {
  it('ships three distinct, contrast-guarded presets', () => {
    expect(Object.keys(THEME_PRESETS)).toEqual(['harbor', 'manuscript', 'signal']);
    expect(new Set(Object.values(THEME_PRESETS).map((theme) => theme.layout.shell))).toEqual(new Set(['reference', 'editorial', 'console']));
    expect(new Set(Object.values(THEME_PRESETS).map((theme) => theme.layout.contentWidth)).size).toBe(3);
    for (const preset of Object.values(THEME_PRESETS)) {
      expect(themeContrastIssues(preset)).toEqual([]);
    }
  });

  it('migrates legacy appearance fields into the compatible default resolver', () => {
    const theme = resolveTheme({ styling: { primaryColor: '#123456', radius: 'pill' } });
    expect(theme.id).toBe('harbor');
    expect(theme.layout.radius).toBe('pill');
    expect(theme.colors.light.accent).toBe('#123456');
    expect(theme.colors.dark.accent).not.toBe('#123456');
  });

  it('exports deterministic canonical JSON', () => {
    const template = themeTemplateFromConfig({ typography: { bodyFont: 'Geist' }, theme: { preset: 'signal' } });
    const first = canonicalThemeTemplateJson(template);
    const second = canonicalThemeTemplateJson(JSON.parse(first));
    expect(second).toBe(first);
    expect(first.endsWith('\n')).toBe(true);
  });

  it('merges or replaces only theme-owned fields and previews exact changes', () => {
    const current = { seo: { title: 'Keep me' }, styling: { theme: 'dark', primaryColor: '#112233' }, theme: { preset: 'harbor' } };
    const incoming = { styling: { theme: 'light' as const }, theme: { preset: 'signal' as const } };
    const merged = applyThemeTemplateConfig(current, incoming, 'merge');
    const replaced = applyThemeTemplateConfig(current, incoming, 'replace');
    expect(merged).toMatchObject({ seo: { title: 'Keep me' }, styling: { theme: 'light', primaryColor: '#112233' } });
    expect(replaced).toEqual({ seo: { title: 'Keep me' }, ...incoming });
    expect(previewThemeConfigChanges(current, merged).map((change) => change.path)).toEqual(['styling.theme', 'theme.preset']);
    const rollbackTemplate = themeTemplateFromConfig(current);
    const rolledBack = applyThemeTemplateConfig(merged, rollbackTemplate.config, 'replace');
    expect(rolledBack.seo).toEqual(current.seo);
    expect(themeOwnedConfig(rolledBack)).toEqual(rollbackTemplate.config);
  });

  it('rejects oversized, deeply nested, and prototype-pollution payloads before parsing', () => {
    expect(inspectThemeTemplateInput({ value: 'x'.repeat(129 * 1024) })).toMatchObject({ ok: false });
    let nested: Record<string, unknown> = {};
    for (let index = 0; index < 14; index += 1) nested = { child: nested };
    expect(inspectThemeTemplateInput(nested)).toMatchObject({ ok: false });
    expect(inspectThemeTemplateInput(JSON.parse('{"kind":"nibleaf-theme","__proto__":{"polluted":true}}'))).toEqual({
      ok: false,
      message: 'Theme template contains the unsafe key "__proto__".',
    });
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  });

  it('draws an accent that fails as text in the nearest shade that passes AA, and leaves passing accents alone (PUB-006)', () => {
    // docs.nibleaf.com's brand colour: 3.94:1 on the light canvas as authored.
    const config = { theme: { preset: 'harbor' as const, colors: { light: { accent: '#B96A3D' } } } };
    const { light } = resolveTheme(config).colors;
    expect(contrastRatio(light.accent, light.canvas)).toBeGreaterThanOrEqual(ACCENT_TEXT_CONTRAST);
    // Also on its 10% tint (bg-primary/10), where the active nav item sits.
    const channels = (hex: string) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
    const tint = `#${channels(light.canvas)
      .map((value, index) =>
        Math.round(value * 0.9 + (channels(light.accent)[index] ?? 0) * 0.1)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`;
    expect(contrastRatio(light.accent, tint)).toBeGreaterThanOrEqual(ACCENT_TEXT_CONTRAST);
    expect(light.accent).not.toBe('#b96a3d');
    // The focus ring followed the accent, and the text on it reads.
    expect(light.focus).toBe(light.accent);
    expect(contrastRatio(light.accentForeground, light.accent)).toBeGreaterThanOrEqual(4.5);
    // Still recognisably the brand: a darker shade, same hue family.
    expect(light.accent).toMatch(/^#[89a][0-9a-f][4-6][0-9a-f][2-4][0-9a-f]$/);
    expect(accentTextAdjustments(config)).toEqual([expect.objectContaining({ mode: 'light', from: '#b96a3d', to: light.accent })]);
    // Presets already pass as authored and stay byte-identical.
    for (const id of THEME_PRESET_IDS) {
      expect(resolveTheme({ theme: { preset: id } }).colors).toEqual(THEME_PRESETS[id].colors);
      expect(accentTextAdjustments({ theme: { preset: id } })).toEqual([]);
    }
  });

  it('searches the other way on a mid-tone canvas, and never makes a passing accent worse', () => {
    // 4.63:1 on the canvas as authored, but short on its own tint: towards white
    // never gets there, towards black does.
    const shade = readableAccentText('#303030', '#999999');
    expect(contrastRatio(shade, '#999999')).toBeGreaterThanOrEqual(ACCENT_TEXT_CONTRAST);
    expect(contrastRatio(shade, '#999999')).toBeGreaterThanOrEqual(contrastRatio('#303030', '#999999'));
    // Where nothing passes on canvas and tint, the canvas decides and never gets
    // worse: black on #e61186 reads 4.79:1 as authored and stays as authored.
    expect(readableAccentText('#000000', '#e61186')).toBe('#000000');
  });

  it('never lowers the canvas contrast below the authored accent or AA, across a grid of palettes', () => {
    const levels = ['00', '33', '66', '99', 'cc', 'ff'];
    const colours = levels.flatMap((r) => levels.flatMap((g) => levels.map((b) => `#${r}${g}${b}`)));
    const canvases = ['#ffffff', '#fafafa', '#999999', '#777777', '#e61186', '#1f63c4', '#0b1120', '#000000'];
    for (const canvas of canvases) {
      for (const accent of colours) {
        const result = readableAccentText(accent, canvas);
        const floor = Math.min(contrastRatio(accent, canvas), ACCENT_TEXT_CONTRAST);
        expect(contrastRatio(result, canvas), `${accent} on ${canvas} -> ${result}`).toBeGreaterThanOrEqual(floor - 1e-9);
      }
    }
  });

  it('lightens a dark-mode accent that fails as text on the dark canvas', () => {
    expect(readableAccentText('#2a2a6e', '#0b1120')).not.toBe('#2a2a6e');
    expect(contrastRatio(readableAccentText('#2a2a6e', '#0b1120'), '#0b1120')).toBeGreaterThanOrEqual(ACCENT_TEXT_CONTRAST);
    expect(readableAccentText('#1f63c4', '#fbfcfd')).toBe('#1f63c4');
    expect(readableAccentText('not-a-colour', '#ffffff')).toBe('not-a-colour');
  });

  it('shares strict CSS interpolation sanitizers across renderers', () => {
    expect(safeThemeHex('#AABBCC', '#000000')).toBe('#aabbcc');
    expect(safeThemeHex('#AbC', '#000000')).toBe('#aabbcc');
    expect(safeThemeHex('red;}body{display:none', '#000000')).toBe('#000000');
    expect(resolveTheme({ theme: { colors: { light: { accent: '#AbC' } } } }, { authoredAccent: true }).colors.light).toMatchObject({
      accent: '#aabbcc',
      focus: '#aabbcc',
    });
    expect(safeThemeFontFamily(' نسق عربي ')).toBe('نسق عربي');
    expect(safeThemeFontFamily("Inter';}body{display:none}/*")).toBeUndefined();
  });
});
