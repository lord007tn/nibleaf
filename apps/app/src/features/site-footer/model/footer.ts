/**
 * Site configuration → Footer, as pure logic. One form edits the active scope:
 * "default" edits the project's `config.footer` (copyright, three social links
 * and the "Made with Nibleaf" badge); a language scope edits that language's
 * `config.footer`, which localizes the copyright only. The social links and
 * the badge stay global and are never part of a language save. Rendered by
 * `components/footer-settings.tsx`.
 */

/** The project's `config.footer` as the API stores it. */
export type FooterConfig = { copyright?: string; github?: string; x?: string; linkedin?: string; madeWithBadge?: boolean };

/** A language's `config.footer` override: the copyright only. */
export type LanguageFooterConfig = { copyright?: string };

/**
 * The form's values, the same shape in every scope so one draft follows the
 * scope picker. In a language scope only `copyright` is editable; the other
 * four are the project's, shown read-only and never sent.
 */
export type FooterValues = { copyright: string; github: string; x: string; linkedin: string; madeWithBadge: boolean };

type TextKey = 'copyright' | 'github' | 'x' | 'linkedin';
const TEXT_KEYS: readonly TextKey[] = ['copyright', 'github', 'x', 'linkedin'];

/** The scope the picker selects: the project ("default") or a language id. */
export const PROJECT_SCOPE = 'default';

/** The project scope's values: an unset text is blank, and an unset badge shows (it is on by default). */
export function footerValues(footer: FooterConfig | null | undefined): FooterValues {
  return {
    copyright: footer?.copyright ?? '',
    github: footer?.github ?? '',
    x: footer?.x ?? '',
    linkedin: footer?.linkedin ?? '',
    madeWithBadge: footer?.madeWithBadge !== false,
  };
}

/** A language scope's values: its own copyright (blank when it uses the project's) beside the project's global fields. */
export function languageFooterValues(
  override: LanguageFooterConfig | null | undefined,
  projectFooter: FooterConfig | null | undefined,
): FooterValues {
  return { ...footerValues(projectFooter), copyright: override?.copyright ?? '' };
}

/**
 * The project scope's `config.footer` patch: each text trimmed, and the badge
 * as chosen (an explicit `false` hides it).
 *
 * A text left blank is sent as `''` when the project has a stored value for
 * it: the server merges `footer` key by key and keeps any key a patch leaves
 * out, so an omitted text would come back after the save. The reader shows
 * a stored `''` as no link, and as an empty copyright line. A text the project
 * never stored stays left out, so a site that never set a copyright keeps the
 * reader's automatic "© year name" line when another footer field is saved.
 */
export function projectFooterPatch(values: FooterValues, stored: FooterConfig | null | undefined): FooterConfig {
  const patch: FooterConfig = {};
  for (const key of TEXT_KEYS) {
    const text = values[key].trim();
    if (text || stored?.[key] !== undefined) patch[key] = text;
  }
  patch.madeWithBadge = values.madeWithBadge;
  return patch;
}

/**
 * The project footer as far as the form knows the server holds it: the
 * project query's copy, plus any text key a successful save's response showed
 * stored since this draft began (`confirmed`). Only which keys are present
 * matters (see `projectFooterPatch`). It covers a save whose follow-up refetch
 * failed: the query still lacks a text the server now stores, and clearing that
 * text must still send `''`. The draft's own values never count as stored.
 */
export function knownStoredFooter(read: FooterConfig | null | undefined, confirmed: FooterConfig | null | undefined): FooterConfig {
  const known: FooterConfig = { ...read };
  for (const key of TEXT_KEYS) {
    if (known[key] === undefined && confirmed?.[key] !== undefined) known[key] = confirmed[key];
  }
  return known;
}

/**
 * A language scope's `config` patch: `{ footer: { copyright } }` with the
 * trimmed text, or `{ footer: null }` when it is blank, so the language falls
 * back to the project's copyright. The server keeps the language's name,
 * description, SEO and other chrome either way.
 */
export function languageFooterConfig(values: FooterValues): { footer: LanguageFooterConfig | null } {
  const copyright = values.copyright.trim();
  return { footer: copyright ? { copyright } : null };
}

/**
 * The values a save of `values` stores in its scope, read back as the form
 * reads them. The draft hook records this as what the save sent, so the
 * server echoing the trimmed text is recognised as the save's own echo. A
 * language save sends the copyright only: the global fields stay as they are.
 */
export function sentFooterValues(scope: 'project' | 'language', values: FooterValues, stored: FooterConfig | null | undefined): FooterValues {
  if (scope === 'language') return { ...values, copyright: languageFooterConfig(values).footer?.copyright ?? '' };
  return footerValues(projectFooterPatch(values, stored));
}
