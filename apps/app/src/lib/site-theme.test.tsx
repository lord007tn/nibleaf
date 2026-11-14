import { translateFn } from '@nibleaf/i18n';
import { contrastRatio, readableAccentText } from '@nibleaf/shared/themes';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ThemePreview } from '@/components/project-settings/theme-section';
import {
  DOCUMENTATION_THEME_TEMPLATES,
  DocumentationPageLayout,
  DocumentationProjectPreviewLayout,
  DocumentationReaderLayout,
  DocumentationStudioPreviewLayout,
  DocumentationThemeProvider,
} from '@/components/site/documentation-theme-provider';
import { projectThemeCss, projectThemeStyle, projectThemeVariables, resolveProjectTheme, siteThemeNoFlashScript } from './site-theme';

/** Contrast of `color` on a `weight` tint of itself over `background`, worked
 * out here independently with unrounded channels (no hex rounding). */
const onTint = (color: string, background: string, weight: number) => {
  const rgb = (hex: string) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  const linear = (value: number) => {
    const n = value / 255;
    return n <= 0.040_45 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  const luminance = ([r = 0, g = 0, b = 0]: number[]) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
  const text = luminance(rgb(color));
  const tint = luminance(rgb(background).map((value, index) => value * (1 - weight) + (rgb(color)[index] ?? 0) * weight));
  return (Math.max(text, tint) + 0.05) / (Math.min(text, tint) + 0.05);
};

describe('footer small print contrast', () => {
  const footerColors = (css: string) => [...css.matchAll(/--theme-footer-muted:([^;}]+)/g)].map((match) => match[1]);
  it.each(['harbor', 'manuscript', 'signal'] as const)('clears 4.7:1 on the %s canvas in light and dark', (preset) => {
    const theme = resolveProjectTheme({ theme: { preset } } as never);
    const [light, dark] = footerColors(projectThemeCss({ theme: { preset } } as never));
    expect(contrastRatio(light as string, theme.colors.light.canvas)).toBeGreaterThanOrEqual(4.7);
    expect(contrastRatio(dark as string, theme.colors.dark.canvas)).toBeGreaterThanOrEqual(4.7);
  });
  it('nudges a custom palette accepted at AA (4.54:1) up to 4.7:1, darker on light and lighter on dark', () => {
    const config = {
      theme: {
        preset: 'harbor',
        colors: { light: { mutedForeground: '#737373', canvas: '#fafafa' }, dark: { mutedForeground: '#6f6f6f', canvas: '#0a0a0a' } },
      },
    };
    expect(contrastRatio('#737373', '#fafafa')).toBeLessThan(4.7);
    const [light, dark] = footerColors(projectThemeCss(config as never));
    expect(contrastRatio(light as string, '#fafafa')).toBeGreaterThanOrEqual(4.7);
    expect(contrastRatio(dark as string, '#0a0a0a')).toBeGreaterThanOrEqual(4.7);
    expect(light).toBe(projectThemeVariables(config as never, 'light')['--theme-footer-muted' as keyof object]);
  });
  it('uses #707070 on the legacy light palette (4.74:1 on #fafafa) and the muted token in dark', () => {
    const css = projectThemeCss(null);
    expect(footerColors(css)).toEqual(['#707070', 'var(--muted-foreground)']);
    expect(contrastRatio('#707070', '#fafafa')).toBeGreaterThanOrEqual(4.7);
  });
});

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

  it('fills the kebab-case variable names that reader styles read for multi-word tokens', () => {
    const config = { theme: { preset: 'signal' as const } };
    const theme = resolveProjectTheme(config);
    const variables = projectThemeVariables(config, 'light') as Record<string, string>;
    const css = projectThemeCss(config);
    for (const [kebab, camel, value] of [
      ['--theme-code-foreground', '--theme-codeForeground', theme.colors.light.codeForeground],
      ['--theme-muted-foreground', '--theme-mutedForeground', theme.colors.light.mutedForeground],
      ['--theme-surface-raised', '--theme-surfaceRaised', theme.colors.light.surfaceRaised],
      ['--theme-accent-foreground', '--theme-accentForeground', theme.colors.light.accentForeground],
    ] as const) {
      expect(variables[kebab]).toBe(value);
      expect(variables[camel]).toBe(value);
      expect(css).toContain(`${kebab}:${value}`);
    }
    expect(css).toContain(`--theme-code-foreground:${theme.colors.dark.codeForeground}`);
  });

  it('does not interpolate an unsafe font into CSS', () => {
    const css = projectThemeCss({ typography: { headingFont: "Inter';}body{display:none}/*" } });
    expect(css).not.toContain('display:none');
  });

  it('JSON-encodes the per-site before-paint appearance bootstrap', () => {
    const projectId = 'project";</script><script>alert(1)</script>\u2028';
    const script = siteThemeNoFlashScript(projectId, 'system');
    expect(script).toContain('localStorage.getItem(k)');
    expect(script).toContain("classList.remove('light','dark')");
    expect(script).toContain('classList.add(r)');
    expect(script).toContain('\\u003c/script\\u003e\\u003cscript\\u003ealert(1)');
    expect(script).not.toContain('</script>');
    expect(script).not.toContain('\u2028');
    expect(script).toContain('\\u2028');
    expect(script).not.toContain(`+"${projectId}"`);
  });

  it('accepts bounded Unicode family names and keeps Arabic fallbacks', () => {
    const css = projectThemeCss({ typography: { headingFont: 'نسق عربي' } });
    expect(css).toContain("font-family:'نسق عربي','Noto Sans Arabic Variable','Noto Sans Arabic'");
  });

  it('falls back to the bundled Arabic webfont family under a custom body font', () => {
    // @fontsource-variable/noto-sans-arabic registers "Noto Sans Arabic Variable".
    expect(String(projectThemeStyle({ typography: { bodyFont: 'Inter' } }).fontFamily)).toMatch(/^'Inter','Noto Sans Arabic Variable',/);
  });

  it.each(['#009966', '#387818'])('keeps the rail accent at AA on Signal with accent %s, in the CSS and the dashboard preview', (accent) => {
    const config = { theme: { preset: 'signal', colors: { light: { accent } } } } as never;
    const code = resolveProjectTheme(config).colors.light.code;
    const css = projectThemeCss(config);
    const fromCss = css.match(/:root,\.nibleaf-site-chrome\{[^}]*--theme-code-accent:(#[0-9a-f]{6})/)?.[1] as string;
    const fromPreview = projectThemeVariables(config, 'light')['--theme-code-accent' as never] as string;
    expect(fromCss).toBe(fromPreview);
    // Main drew the authored #009966 here; the canvas shade would have read 4.35:1 on the tint.
    if (accent === '#009966') expect(fromCss).toBe('#009966');
    // The rail's active item: the code accent on a 14% tint of itself, unrounded.
    expect(onTint(fromCss, code, 0.14)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(fromCss, code)).toBeGreaterThanOrEqual(4.5);
  });

  it("draws a pre-v1 site's code accent from its brand, as before", () => {
    expect(projectThemeCss({ styling: { primaryColor: '#5546e8' } } as never)).toContain('--theme-code-accent:color-mix(in oklab,#5546e8 55%,white)');
  });

  it('keeps pre-v1 projects on their existing design-system palette', () => {
    const css = projectThemeCss({ styling: { primaryColor: '#c2410c' } });
    expect(css).toContain('--theme-canvas:var(--background)');
    // The accent is drawn in the shade that reads as text on #fafafa and its tint (PUB-006).
    const accent = readableAccentText('#c2410c', '#fafafa');
    expect(contrastRatio(accent, '#fafafa')).toBeGreaterThanOrEqual(4.5);
    expect(css).toContain(`--primary:${accent}`);
    expect(css).toContain('--primary-foreground:#ffffff');
    // Dark keeps the design system's on-primary text it always had.
    expect(css).toMatch(/\.dark\{[^}]*--primary-foreground:#171717/);
    // ...and mixes the brand itself towards white, unchanged from before.
    expect(css).toContain('color-mix(in oklab,#c2410c 72%,white)');
    expect(css).not.toContain('--background:#f8fafc');
  });

  it('renders an RTL theme preview while preserving LTR code', () => {
    const markup = renderToStaticMarkup(<ThemePreview arabic config={{ theme: { preset: 'manuscript' } }} mode="dark" />);
    expect(markup).toContain('dir="rtl"');
    expect(markup).toContain('data-theme-id="manuscript"');
    expect(markup).toContain('data-theme-shell="editorial"');
    expect(markup).toContain('data-theme-navigation="tree"');
    expect(markup).toContain('data-theme-sidebar="soft"');
    expect(markup).toContain('dir="ltr"');
    expect(markup).toContain(translateFn('settings.theme.preview.productDocs', undefined, 'ar'));
  });

  it.each([
    ['harbor', 'reference', 'harbor-reference'],
    ['manuscript', 'editorial', 'manuscript-editorial'],
    ['signal', 'console', 'signal-console'],
  ] as const)('renders the %s preset with its own reader and page templates', (preset, shell, layout) => {
    const theme = resolveProjectTheme({ theme: { preset } });
    const markup = renderToStaticMarkup(
      <DocumentationThemeProvider className="flex" context="reader" direction="ltr" theme={theme}>
        <DocumentationReaderLayout
          banner={<div>banner</div>}
          content={<main>article</main>}
          footer={<footer>footer</footer>}
          header={<header>header</header>}
          navigation={<nav>navigation</nav>}
          overlays={<div>search</div>}
        />
        <DocumentationPageLayout article={<article>page</article>} tableOfContents={<nav>outline</nav>} />
        <DocumentationProjectPreviewLayout
          content={<main>project content</main>}
          mobileNavigation={<nav>mobile</nav>}
          navigation={<nav>project navigation</nav>}
        />
        <DocumentationStudioPreviewLayout
          content={<main>studio content</main>}
          header={<header>studio header</header>}
          navigation={<nav>studio navigation</nav>}
        />
      </DocumentationThemeProvider>,
    );

    expect(theme.layout.shell).toBe(shell);
    expect(markup).toContain(`data-documentation-template="${preset}"`);
    expect(markup).toContain(`data-documentation-layout="${layout}"`);
    expect(markup).toContain(`data-documentation-layout="${layout}-page"`);
    expect(markup).toContain(`data-documentation-layout="${layout}-preview"`);
    expect(markup).toContain(`data-documentation-layout="${layout}-studio"`);
  });

  it('selects templates by the customizable shell contract without changing preset metadata', () => {
    const theme = resolveProjectTheme({ theme: { preset: 'harbor', layout: { shell: 'console' } } });
    const markup = renderToStaticMarkup(
      <DocumentationThemeProvider context="reader" direction="rtl" theme={theme}>
        <DocumentationReaderLayout content={<main />} header={<header />} navigation={<nav />} />
      </DocumentationThemeProvider>,
    );

    expect(Object.keys(DOCUMENTATION_THEME_TEMPLATES)).toEqual(['reference', 'editorial', 'console']);
    expect(markup).toContain('data-theme-id="harbor"');
    expect(markup).toContain('data-theme-shell="console"');
    expect(markup).toContain('data-documentation-template="signal"');
    expect(markup).toContain('data-documentation-layout="signal-console"');
    expect(markup).toContain('dir="rtl"');
  });
});
