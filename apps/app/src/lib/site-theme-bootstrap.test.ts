import { describe, expect, it } from 'vitest';
import { siteThemeNoFlashScript as reExported } from './site-theme';
import { siteThemeNoFlashScript } from './site-theme-bootstrap';

// The root document inlines this script into every published page's <head>.
// It moved out of site-theme.ts so the root no longer imports the theme maths;
// these strings pin its exact output from before the move.
describe('siteThemeNoFlashScript', () => {
  it('produces the same bytes as before it moved', () => {
    expect(siteThemeNoFlashScript('preview-harbor', 'dark')).toBe(
      "(function(){try{var k='nibleaf.site.theme.'+\"preview-harbor\";var s=localStorage.getItem(k);var c=\"dark\";var d=s==='dark'||(s!=='light'&&(c==='dark'||(c==='system'&&matchMedia('(prefers-color-scheme: dark)').matches)));var r=d?'dark':'light';var e=document.documentElement;e.classList.remove('light','dark');e.classList.add(r);e.style.colorScheme=r;}catch(_){}})();",
    );
  });

  it('defaults to the system appearance and escapes the project id for an inline script', () => {
    expect(siteThemeNoFlashScript('</script><b>&\u2028')).toBe(
      "(function(){try{var k='nibleaf.site.theme.'+\"\\u003c/script\\u003e\\u003cb\\u003e\\u0026\\u2028\";var s=localStorage.getItem(k);var c=\"system\";var d=s==='dark'||(s!=='light'&&(c==='dark'||(c==='system'&&matchMedia('(prefers-color-scheme: dark)').matches)));var r=d?'dark':'light';var e=document.documentElement;e.classList.remove('light','dark');e.classList.add(r);e.style.colorScheme=r;}catch(_){}})();",
    );
  });

  it('is the one site-theme.ts still exports', () => {
    expect(reExported).toBe(siteThemeNoFlashScript);
  });
});
