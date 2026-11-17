import { configureDashboardLocaleLoading, prepareDashboardLocale } from '@nibleaf/i18n/dashboard-catalog';
import { getLocale, renderedLocale } from '@nibleaf/i18n/locale-state';
import type { Locale } from '@nibleaf/i18n/locales';
import { needsDashboardLocale } from '@/lib/dashboard-locale-path';
import { runOptionalLoad } from '@/lib/document-recovery';

configureDashboardLocaleLoading(runOptionalLoad, () => needsDashboardLocale(window.location.pathname));

/** Navigation uses the current choice; hydration uses the server snapshot. */
export const loadDashboardLocale = () => prepareDashboardLocale(getLocale() as Locale);
export const hydrateDashboardLocale = () => prepareDashboardLocale(renderedLocale());
