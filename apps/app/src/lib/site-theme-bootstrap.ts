import type { ProjectConfig } from '@nibleaf/validators';

// The root document's part of the published site's theme: what the reader
// opens in, and the inline script that applies it before CSS paints. It lives
// apart from site-theme.ts because __root and root-document import it on every
// page, and the theme tokens and their contrast maths are only the reader's.

const inlineScriptJson = (value: string): string =>
  JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');

export type SiteAppearance = 'light' | 'dark' | 'system';

/** The appearance a published site opens in until the reader picks one. A site
 * whose owner never chose follows the reader's device, as nibleaf.com does
 * (PUB-004); an explicit 'light' or 'dark' still wins. The reader, the no-flash
 * script and the theme settings all read it here, so they can't disagree. */
export const siteAppearance = (config?: Pick<ProjectConfig, 'styling'> | null): SiteAppearance => config?.styling?.theme ?? 'system';

/** Run after the dashboard bootstrap in `<head>` so a published site's stored
 * appearance wins before CSS paints. Inputs are JSON-encoded and the default is
 * already constrained by ProjectConfig's appearance enum. */
export const siteThemeNoFlashScript = (projectId: string, configured: SiteAppearance = 'system'): string =>
  `(function(){try{var k='nibleaf.site.theme.'+${inlineScriptJson(projectId)};var s=localStorage.getItem(k);var c=${inlineScriptJson(configured)};var d=s==='dark'||(s!=='light'&&(c==='dark'||(c==='system'&&matchMedia('(prefers-color-scheme: dark)').matches)));var r=d?'dark':'light';var e=document.documentElement;e.classList.remove('light','dark');e.classList.add(r);e.style.colorScheme=r;}catch(_){}})();`;
