import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ThemePreview } from '@/components/project-settings/theme-section';
import { projectThemeCss, projectThemeVariables, resolveProjectTheme, siteThemeNoFlashScript } from './site-theme';

describe('published theme projection', () => {
  it('projects a preset and semantic overrides onto the stable CSS interface', () => {
    const config = {
      theme: { preset: 'signal' as const, colors: { light: { surface: '#fefefe' } } },
      styling: { primaryColor: '#3300aa' },
      typography: { bodyFont: 'Inter', codeFont: 'Geist Mono' },
    };
    const theme = resolveProjectTheme(config);
    const variables = projectThemeVariables(config, 'light') as Record<string, string>;
    expect(theme.id).toBe('signal');
    expect(variables['--theme-surface']).toBe('#fefefe');
    expect(variables['--primary']).toBe(theme.colors.light.accent);
    expect(projectThemeCss(config)).toContain("font-family:'Geist Mono'");
  });

  it('does not interpolate an unsafe font into CSS', () => {
    const css = projectThemeCss({ typography: { headingFont: "Inter';}body{display:none}/*" } });
    expect(css).not.toContain('display:none');
  });

  it('JSON-encodes the per-site before-paint appearance bootstrap', () => {
    const projectId = 'project";</script><script>alert(1)</script>\u2028';
    const script = siteThemeNoFlashScript(projectId, 'system');
    expect(script).toContain('localStorage.getItem(k)');
    expect(script).toContain('\\u003c/script\\u003e\\u003cscript\\u003ealert(1)');
    expect(script).not.toContain('</script>');
    expect(script).not.toContain('\u2028');
    expect(script).toContain('\\u2028');
    expect(script).not.toContain(`+"${projectId}"`);
  });

  it('accepts bounded Unicode family names and keeps Arabic fallbacks', () => {
    const css = projectThemeCss({ typography: { headingFont: 'نسق عربي' } });
    expect(css).toContain("font-family:'نسق عربي','Noto Sans Arabic'");
  });

  it('keeps pre-v1 projects on their existing design-system palette', () => {
    const css = projectThemeCss({ styling: { primaryColor: '#c2410c' } });
    expect(css).toContain('--theme-canvas:var(--background)');
    expect(css).toContain('--primary:#c2410c');
    expect(css).not.toContain('--background:#f8fafc');
  });

  it('renders an RTL theme preview while preserving LTR code', () => {
    const markup = renderToStaticMarkup(<ThemePreview arabic config={{ theme: { preset: 'manuscript' } }} mode="dark" />);
    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('data-theme-id="manuscript"');
    expect(markup).toContain('data-theme-navigation="tree"');
    expect(markup).toContain('data-theme-sidebar="soft"');
    expect(markup).toContain('dir="ltr"');
    expect(markup).toContain('وثائق المنتج');
  });
});
