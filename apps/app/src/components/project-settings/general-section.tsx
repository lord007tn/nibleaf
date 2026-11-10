/**
 * Site settings → General now lives in `features/site-general`. The settings
 * route (frozen until the organizations shell merges) still imports it from
 * here; once it imports the feature directly, delete this file.
 */
export { GeneralSettings as GeneralSection } from '@/features/site-general/components/general-settings';
