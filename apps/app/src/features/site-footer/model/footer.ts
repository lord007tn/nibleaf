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
 * The project scope's values as a save sends them: every text trimmed. A pure
 * transform (the draft hook also applies it to the baseline and to refetched
 * values), so a key counts as changed exactly when its trimmed value differs.
 */
const trimmedFooter = (values: FooterValues): FooterValues => ({
  copyright: values.copyright.trim(),
  github: values.github.trim(),
  x: values.x.trim(),
  linkedin: values.linkedin.trim(),
  madeWithBadge: values.madeWithBadge,
});

/**
 * The project scope's `config.footer` patch: only the keys the person changed
 * from `baseline` (what the server last confirmed for this draft), each text
 * trimmed. A text cleared to blank is sent as `''` (the server merges `footer`
 * key by key and keeps any key a patch leaves out; the reader shows a stored
 * `''` as no link, and as an empty copyright line). The badge is sent only
 * when switched, as an explicit `true` or `false`.
 *
 * A key the person didn't change is never sent, so the server keeps whatever
 * it holds there: another writer's link, or no copyright at all, which keeps
 * the reader's automatic "© year name" line. Typing into a blank field and
 * clearing it again changes nothing, so nothing is sent for it.
 */
export function projectFooterPatch(values: FooterValues, baseline: FooterValues): FooterConfig {
  const sent = trimmedFooter(values);
  const from = trimmedFooter(baseline);
  const patch: FooterConfig = {};
  for (const key of TEXT_KEYS) {
    if (sent[key] !== from[key]) patch[key] = sent[key];
  }
  if (sent.madeWithBadge !== from.madeWithBadge) patch.madeWithBadge = sent.madeWithBadge;
  return patch;
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
 * reads them; the draft hook's `toSent`. A project save stores the changed
 * keys trimmed and keeps the rest as the server holds them, which for an
 * unchanged key is the baseline the form shows: so all texts trimmed. A
 * language save sends the copyright only: the global fields stay as they are.
 */
export function sentFooterValues(scope: 'project' | 'language', values: FooterValues): FooterValues {
  if (scope === 'language') return { ...values, copyright: languageFooterConfig(values).footer?.copyright ?? '' };
  return trimmedFooter(values);
}
