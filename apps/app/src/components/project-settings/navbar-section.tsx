/**
 * Site configuration → Navbar now lives in `features/site-navbar`. The
 * editor's Configuration panel (`editor/site-config-panel.tsx`) still imports
 * it from here; once it imports the feature directly, delete this file.
 */
export { NavbarSettings as NavbarSection } from '@/features/site-navbar/components/navbar-settings';
