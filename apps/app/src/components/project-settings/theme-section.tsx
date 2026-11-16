/**
 * Site configuration → Themes now lives in `features/site-theme`. The editor's
 * Configuration panel, the theme fixtures and `ThemePreview`'s consumers still
 * import it from here; once they import the feature directly, delete this file.
 */
export { ThemePreview } from '@/features/site-theme/components/theme-preview';
export { ThemeSettings as ThemeSection } from '@/features/site-theme/components/theme-settings';
