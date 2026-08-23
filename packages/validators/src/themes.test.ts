import { themeTemplateFromConfig } from '@nibleaf/shared/themes';
import { describe, expect, it } from 'vitest';
import { parseThemeTemplate, themeConfigSchema, themeTemplateV1Schema } from './themes';

describe('theme template schema', () => {
  it('round-trips a current template deterministically', () => {
    const source = themeTemplateFromConfig({
      theme: { preset: 'manuscript', layout: { shell: 'editorial', contentWidth: 'focused' } },
      typography: { headingFont: 'Geist', bodyFont: 'Inter', codeFont: 'Geist Mono' },
    });
    const parsed = parseThemeTemplate(JSON.parse(JSON.stringify(source)));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.template).toEqual(source);
  });

  it('migrates legacy v0 fields to the v1 model', () => {
    const parsed = parseThemeTemplate({
      kind: 'nibleaf-theme',
      version: 0,
      name: 'Legacy docs',
      preset: 'signal',
      primaryColor: '#4f46e5',
      appearance: 'system',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.migratedFrom).toBe(0);
      expect(parsed.template).toMatchObject({
        version: 1,
        config: { theme: { preset: 'signal' }, styling: { primaryColor: '#4f46e5', theme: 'system' } },
      });
    }
  });

  it('rejects executable fields, unsafe asset schemes, and future versions with actionable errors', () => {
    const base = themeTemplateFromConfig({ theme: { preset: 'harbor' } });
    expect(themeTemplateV1Schema.safeParse({ ...base, customCss: 'body{}' }).success).toBe(false);
    expect(themeTemplateV1Schema.safeParse({ ...base, config: { ...base.config, branding: { logoLight: 'javascript:alert(1)' } } }).success).toBe(
      false,
    );
    expect(themeTemplateV1Schema.safeParse({ ...base, config: { ...base.config, branding: { logoHref: '//attacker.example' } } }).success).toBe(
      false,
    );
    expect(
      themeTemplateV1Schema.safeParse({ ...base, config: { ...base.config, branding: { logoHref: 'https://user:secret@example.com' } } }).success,
    ).toBe(false);
    expect(themeTemplateV1Schema.safeParse({ ...base, config: { ...base.config, branding: { logoLight: '/assets/%2e%2e/secret' } } }).success).toBe(
      false,
    );
    expect(themeTemplateV1Schema.safeParse({ ...base, config: { ...base.config, branding: { logoHref: '/../admin' } } }).success).toBe(false);
    const future = parseThemeTemplate({ ...base, version: 99 });
    expect(future).toMatchObject({ success: false });
    if (!future.success) expect(future.message).toContain('supports versions 0 and 1');
  });

  it('rejects custom semantic colors that fail contrast', () => {
    expect(
      themeConfigSchema.safeParse({
        preset: 'harbor',
        colors: { light: { canvas: '#ffffff', foreground: '#fefefe', mutedForeground: '#fdfdfd' } },
      }).success,
    ).toBe(false);
  });
});
