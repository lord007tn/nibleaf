import { NibleafMark } from '@nibleaf/design-system/brand';

/**
 * "Made with Nibleaf" attribution + a low-key abuse-report contact, shown in the
 * published-site footer. On by default; site owners can hide it with the
 * `footer.madeWithBadge` config toggle (Site configuration → Footer) — the
 * platform is a free beta, so the toggle is available to everyone.
 *
 * Strings live here (not lib/site-i18n.ts) so the badge stays self-contained;
 * the same en/ar + fallback-to-English rule applies. RTL-safe: flex + gap only,
 * no directional margins.
 */
const STRINGS = {
  en: { madeWith: 'Made with', reportAbuse: 'Report abuse' },
  ar: { madeWith: 'صُنع باستخدام', reportAbuse: 'الإبلاغ عن إساءة' },
} as const;

const stringsFor = (langCode?: string) => {
  const bareCode = (langCode ?? 'en').toLowerCase().split('-')[0];
  return bareCode === 'ar' ? STRINGS.ar : STRINGS.en;
};

export function MadeWithBadge({ lang }: { lang?: string }) {
  const t = stringsFor(lang);
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground/80">
      <a
        href="https://nibleaf.com/?utm_source=badge"
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
      >
        <NibleafMark className="size-3.5" aria-hidden />
        <span>
          {t.madeWith} <span className="font-semibold">Nibleaf</span>
        </span>
      </a>
      <span aria-hidden>·</span>
      <a href="mailto:abuse@nibleaf.com" className="transition-colors hover:text-foreground">
        {t.reportAbuse}
      </a>
    </div>
  );
}
