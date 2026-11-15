/**
 * Site settings → Integrations → Analytics now lives in
 * `features/site-analytics-settings`. The integrations tab still imports it
 * from here; once it imports the feature directly, delete this file.
 */
export { AnalyticsSettings as AnalyticsSection } from '@/features/site-analytics-settings/components/analytics-settings';
