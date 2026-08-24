import { translateFn } from '@nibleaf/i18n';
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
