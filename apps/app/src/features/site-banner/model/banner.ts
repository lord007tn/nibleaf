/**
 * The announcement banner's draft, as pure values. One form edits all five
 * fields for the active scope: "default" edits the project's
 * `config.banner`; a language scope edits that language's `config.banner`
 * override, which inherits whatever it leaves out from the project.
 */

/** The stored banner shape, for the project and for a language override alike. */
export type BannerConfig = {
  enabled?: boolean;
  dismissible?: boolean;
  message?: string;
  linkLabel?: string;
  linkUrl?: string;
};

/** The five editable values, the same in every scope. */
export type BannerValues = {
  enabled: boolean;
  dismissible: boolean;
  message: string;
  linkLabel: string;
  linkUrl: string;
};

/** The scope the picker selects: the project ("default") or a language id. */
export const PROJECT_SCOPE = 'default';

/** What the reader assumes when the project banner leaves a toggle unset. */
const DEFAULT_ENABLED = false;
const DEFAULT_DISMISSIBLE = true;

type TextKey = 'message' | 'linkLabel' | 'linkUrl';
const TEXT_KEYS: readonly TextKey[] = ['message', 'linkLabel', 'linkUrl'];

/** The project banner's effective toggles, with the reader's defaults filled in. */
const inheritedToggles = (projectBanner: BannerConfig | null | undefined) => ({
  enabled: projectBanner?.enabled ?? DEFAULT_ENABLED,
  dismissible: projectBanner?.dismissible ?? DEFAULT_DISMISSIBLE,
});

/** The project scope's values from `project.config.banner`. */
export function projectBannerValues(banner: BannerConfig | null | undefined): BannerValues {
  return {
    ...inheritedToggles(banner),
    message: banner?.message ?? '',
    linkLabel: banner?.linkLabel ?? '',
    linkUrl: banner?.linkUrl ?? '',
  };
}

/**
 * A language scope's values. Text comes from the override only (an empty field
 * means "use the project's", shown as its placeholder); each toggle shows the
 * override, falling back to the project's effective value.
 */
export function languageBannerValues(override: BannerConfig | null | undefined, projectBanner: BannerConfig | null | undefined): BannerValues {
  const inherited = inheritedToggles(projectBanner);
  return {
    enabled: override?.enabled ?? inherited.enabled,
    dismissible: override?.dismissible ?? inherited.dismissible,
    message: override?.message ?? '',
    linkLabel: override?.linkLabel ?? '',
    linkUrl: override?.linkUrl ?? '',
  };
}

/** The project's text, shown as placeholders in a language scope so an empty field reads as inherited. */
export function inheritedPlaceholders(projectBanner: BannerConfig | null | undefined): Partial<Record<TextKey, string>> {
  const placeholders: Partial<Record<TextKey, string>> = {};
  for (const key of TEXT_KEYS) {
    const value = projectBanner?.[key];
    if (value) placeholders[key] = value;
  }
  return placeholders;
}

/**
 * What is wrong with the link address: empty is fine (no link, or the
 * project's in a language scope); otherwise it must be an absolute http(s)
 * URL. The reader links to it as stored, so a relative or bare path would
 * resolve against whatever page shows the banner.
 */
export function linkUrlProblem(value: string): 'invalid' | undefined {
  const address = value.trim();
  if (!address) return undefined;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return 'invalid';
  }
  return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname ? undefined : 'invalid';
}

/** The project scope's `config.banner` patch: both toggles, and each text trimmed or left out when empty. */
export function projectBannerPatch(values: BannerValues): BannerConfig {
  return {
    enabled: values.enabled,
    dismissible: values.dismissible,
    message: values.message.trim() || undefined,
    linkLabel: values.linkLabel.trim() || undefined,
    linkUrl: values.linkUrl.trim() || undefined,
  };
}

/**
 * A language scope's override: each nonempty text, trimmed, and only the
 * toggles that differ from what the language would inherit. An explicit
 * `false` that differs is kept. Nothing left to override clears it (`null`),
 * so the language falls back to the project banner.
 */
export function languageBannerOverride(values: BannerValues, projectBanner: BannerConfig | null | undefined): BannerConfig | null {
  const inherited = inheritedToggles(projectBanner);
  const override: BannerConfig = {};
  for (const key of TEXT_KEYS) {
    const text = values[key].trim();
    if (text) override[key] = text;
  }
  if (values.enabled !== inherited.enabled) override.enabled = values.enabled;
  if (values.dismissible !== inherited.dismissible) override.dismissible = values.dismissible;
  return Object.keys(override).length > 0 ? override : null;
}
