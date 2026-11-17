/**
 * Site configuration → Redirects now lives in `features/site-redirects`. The
 * editor's Configuration panel (`editor/site-config-panel.tsx`) still imports
 * it from here; once it imports the feature directly, delete this file.
 */
export { RedirectsSettings as RedirectsSection } from '@/features/site-redirects/components/redirects-settings';
