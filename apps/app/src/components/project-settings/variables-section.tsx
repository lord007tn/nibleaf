/**
 * Site configuration → Variables now lives in `features/site-variables`. The
 * Appearance hosts (`editor/site-config-panel.tsx`) still import it from here;
 * once they import the feature directly, delete this file.
 */
export { VariablesSettings as VariablesSection } from '@/features/site-variables/components/variables-settings';
