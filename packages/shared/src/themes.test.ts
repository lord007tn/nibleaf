import { describe, expect, it } from 'vitest';
import {
  applyThemeTemplateConfig,
  canonicalThemeTemplateJson,
  inspectThemeTemplateInput,
  previewThemeConfigChanges,
  resolveTheme,
  THEME_PRESETS,
  themeContrastIssues,
  themeOwnedConfig,
  themeTemplateFromConfig,
} from './themes';

describe('documentation themes', () => {
  it('ships three distinct, contrast-guarded presets', () => {
    expect(Object.keys(THEME_PRESETS)).toEqual(['harbor', 'manuscript', 'signal']);
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
});
