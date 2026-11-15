/**
 * Site configuration → Banner now lives in `features/site-banner`. The
 * Appearance hosts (`editor/site-config-panel.tsx`) still import it from here;
 * once they import the feature directly, delete this file.
 */
export { BannerSettings as BannerSection } from '@/features/site-banner/components/banner-settings';
