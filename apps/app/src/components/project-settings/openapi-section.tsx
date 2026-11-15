/**
 * Site settings → OpenAPI now lives in `features/site-openapi`. The settings
 * route still imports it from here; once it imports the feature directly,
 * delete this file.
 */
export { OpenApiSettings as OpenApiSection } from '@/features/site-openapi/components/openapi-settings';
