import type { AppearanceLink, AppearanceSectionId } from '@/features/site-settings/model/ids';

/** Appearance's seven former tabs, and the part of the one page that holds each now. */
const FORMER_TABS: Record<Exclude<AppearanceLink, AppearanceSectionId>, AppearanceSectionId> = {
  branding: 'brand',
  themes: 'theme',
  styling: 'theme',
  navbar: 'chrome',
  footer: 'chrome',
  banner: 'chrome',
};

/** The part an `appearanceSection` link opens: an old tab link opens the part that holds it now. */
export const appearancePart = (link: AppearanceLink): AppearanceSectionId =>
  Object.hasOwn(FORMER_TABS, link) ? FORMER_TABS[link as keyof typeof FORMER_TABS] : (link as AppearanceSectionId);
