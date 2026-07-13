import type { ProjectConfig } from '@nibleaf/validators';
import type { CSSProperties } from 'react';

/** Charset-guard a configured font name before it is interpolated into CSS
 *  (same defense-in-depth rule the site chrome applies). */
const safeFont = (font?: string): string | undefined => {
  const trimmed = font?.trim();
  return trimmed && /^[A-Za-z0-9 ]+$/.test(trimmed) ? trimmed : undefined;
};

/**
 * CSS variables that drive typeset.css (and the editor's ProseMirror styles)
 * from `config.typography` — the shared contract between the published site,
 * the preview, and the editor, so authors always see the rhythm readers get.
 */
export function typographyVars(typography: ProjectConfig['typography'] | undefined): CSSProperties {
  const style: Record<string, string> = {};
  if (!typography) {
    return style;
  }
  const body = safeFont(typography.bodyFont);
  const heading = safeFont(typography.headingFont);
  const code = safeFont(typography.codeFont);
  if (typography.baseSize) {
    style['--typeset-size'] = `${typography.baseSize}px`;
  }
  if (typography.leading) {
    style['--typeset-leading'] = typography.leading;
  }
  if (typography.flow) {
    style['--typeset-flow'] = `${typography.flow}em`;
  }
  if (body) {
    style['--typeset-font-body'] = `'${body}', var(--font-sans, system-ui, sans-serif)`;
  }
  if (heading) {
    style['--typeset-font-heading'] = `'${heading}', var(--font-sans, sans-serif)`;
  }
  if (code) {
    style['--typeset-font-mono'] = `'${code}', var(--font-mono, monospace)`;
  }
  return style as CSSProperties;
}
