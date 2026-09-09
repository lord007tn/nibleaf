import { siteT } from '@nibleaf/i18n/site';

export const OPEN_MARKETING_PRIVACY_CHOICES = 'nibleaf:open-marketing-privacy-choices';

export function PrivacyChoices({ language = 'en' }: { language?: 'en' | 'ar' }) {
  return (
    <button
      type="button"
      className="cursor-pointer text-start text-muted-foreground hover:text-foreground hover:underline"
      onClick={(event) => window.dispatchEvent(new CustomEvent(OPEN_MARKETING_PRIVACY_CHOICES, { detail: event.currentTarget }))}
    >
      {siteT(language)('analyticsConsentManage')}
    </button>
  );
}
