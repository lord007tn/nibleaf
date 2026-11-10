/**
 * Site settings → Add-ons, as pure logic: how add-ons are grouped and named,
 * which ones have settings, what those settings forms edit and send, how their
 * addresses are checked, and who may change what. Rendered by
 * `components/addons-settings.tsx`; tested in `addons.test.ts`.
 */
import type { MessageKey } from '@nibleaf/i18n';
import { ADDON_GROUPS, ADDON_REGISTRY, type AddonGroup, type AddonId, addonConfigSchemas } from '@nibleaf/shared/addons';

/** The parts of a server add-on these rules read. */
export type AddonLike = {
  id: AddonId;
  group: AddonGroup;
  config: Record<string, unknown>;
  status: 'active' | 'inactive' | 'needs_configuration' | 'unavailable';
  availability: { state: 'available' | 'preview' | 'coming_soon'; available: boolean };
};

/** `useProjectAdminStatus(projectId).status`: whether the person may manage this site's settings. */
export type AdminStatus = 'admin' | 'notAdmin' | 'pending';

export const ADDON_TEXT: Record<AddonId, { title: MessageKey; description: MessageKey }> = {
  feedback: { title: 'settings.addons.feedback.title', description: 'settings.addons.feedback.hint' },
  'edit-suggestions': { title: 'settings.addons.editSuggestions.title', description: 'settings.addons.editSuggestions.hint' },
  'issue-links': { title: 'settings.addons.issueLinks.title', description: 'settings.addons.issueLinks.hint' },
  'consent-banner': { title: 'settings.addons.consent.title', description: 'settings.addons.consent.description' },
  'ci-checks': { title: 'settings.addons.ciChecks.title', description: 'settings.addons.ciChecks.hint' },
  'broken-links': { title: 'settings.addons.brokenLinks.title', description: 'settings.addons.brokenLinks.hint' },
  'grammar-linter': { title: 'settings.addons.grammarLinter.title', description: 'settings.addons.grammarLinter.hint' },
  'preview-deployments': { title: 'settings.addons.previewDeployments.title', description: 'settings.addons.previewDeployments.hint' },
};

export const ADDON_GROUP_TEXT: Record<AddonGroup, { title: MessageKey; description: MessageKey }> = {
  engagement: { title: 'settings.addons.group.engagement.title', description: 'settings.addons.group.engagement.description' },
  privacy: { title: 'settings.addons.group.privacy.title', description: 'settings.addons.group.privacy.description' },
  publishing: { title: 'settings.addons.group.publishing.title', description: 'settings.addons.group.publishing.description' },
};

/**
 * The add-ons by group, in the registry's group order and the server's add-on
 * order. A group with no add-ons is left out. (The server lists every
 * registered add-on, so today none is ever empty.)
 */
export function addonGroups<T extends Pick<AddonLike, 'group'>>(addons: readonly T[]): Array<{ id: AddonGroup; addons: T[] }> {
  return ADDON_GROUPS.map((id) => ({ id, addons: addons.filter((addon) => addon.group === id) })).filter((group) => group.addons.length > 0);
}

// ─── Badges ─────────────────────────────────────────────────────────────────

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/**
 * The badges next to an add-on's description. On and off are the switch's to
 * say, so only what the switch can't show gets a badge: a preview, an add-on
 * that needs settings before it works, and one the plan doesn't include.
 */
export function addonBadges(addon: Pick<AddonLike, 'status' | 'availability'>): Array<{ tone: BadgeTone; label: MessageKey }> {
  const badges: Array<{ tone: BadgeTone; label: MessageKey }> = [];
  if (addon.availability.state === 'preview') badges.push({ tone: 'info', label: 'settings.addons.availability.preview' });
  if (addon.status === 'needs_configuration') badges.push({ tone: 'warning', label: 'settings.addons.status.needsconfiguration' });
  if (addon.status === 'unavailable') badges.push({ tone: 'neutral', label: 'settings.addons.status.unavailable' });
  return badges;
}

// ─── Access ─────────────────────────────────────────────────────────────────

/**
 * What a control may do:
 * - `allowed`: usable;
 * - `locked`: disabled with nothing to say (access still loading, a write in flight,
 *   or the section is read-only and says why once at the top);
 * - `denied`: disabled, with the reason shown next to it.
 */
export type Decision = { kind: 'allowed' } | { kind: 'locked' } | { kind: 'denied'; reason: MessageKey };

const allowed: Decision = { kind: 'allowed' };
const locked: Decision = { kind: 'locked' };

/** `useProjectAdminStatus(projectId).edit`: whether the person may change content. */
export type EditStatus = 'pending' | 'edit' | 'viewOnly' | 'unknown';

/**
 * Someone who isn't a site Admin sees the add-ons read-only, with one note at
 * the top saying why (worded for Viewers when they are one). Null for Admins,
 * and while access is still loading (controls are locked without a word).
 */
export function readOnlyNote(status: AdminStatus, edit: EditStatus): MessageKey | null {
  if (status !== 'notAdmin') return null;
  return edit === 'viewOnly' ? 'settings.permissions.viewerBody' : 'settings.permissions.body';
}

/** The on/off switch: Admins only, never while a switch for it is saving, and only for add-ons the plan includes. */
export function toggleDecision(addon: Pick<AddonLike, 'availability'>, status: AdminStatus, saving: boolean): Decision {
  if (status !== 'admin' || saving) return locked;
  if (!addon.availability.available) return { kind: 'denied', reason: 'settings.addons.unavailableDescription' };
  return allowed;
}

/** An add-on's settings fields: Admins only. They stay editable while the add-on is off, so it can be set up first. */
export const settingsDecision = (status: AdminStatus): Decision => (status === 'admin' ? allowed : locked);

// ─── Settings forms ─────────────────────────────────────────────────────────

/** Which settings form an add-on has, if any. */
export type AddonSettingsKind = 'feedback' | 'urlTemplate' | 'consent';

const SETTINGS_KIND: Partial<Record<AddonId, AddonSettingsKind>> = {
  feedback: 'feedback',
  'edit-suggestions': 'urlTemplate',
  'issue-links': 'urlTemplate',
  'consent-banner': 'consent',
};

export const addonSettingsKind = (id: AddonId): AddonSettingsKind | null => SETTINGS_KIND[id] ?? null;

type Option<V extends string> = { value: V; label: MessageKey };

export const FEEDBACK_PLACEMENTS = [
  { value: 'after-content', label: 'settings.addons.feedback.placement.afterContent' },
  { value: 'after-navigation', label: 'settings.addons.feedback.placement.afterNavigation' },
] as const satisfies ReadonlyArray<Option<string>>;
export const FEEDBACK_PRESENTATIONS = [
  { value: 'compact', label: 'settings.addons.feedback.presentation.compact' },
  { value: 'card', label: 'settings.addons.feedback.presentation.card' },
] as const satisfies ReadonlyArray<Option<string>>;
export const CONSENT_PLACEMENTS = [
  { value: 'bottom-start', label: 'settings.addons.consent.placement.start' },
  { value: 'bottom-center', label: 'settings.addons.consent.placement.center' },
  { value: 'bottom-end', label: 'settings.addons.consent.placement.end' },
] as const satisfies ReadonlyArray<Option<string>>;
export const CONSENT_PRESENTATIONS = [
  { value: 'compact', label: 'settings.addons.consent.presentation.compact' },
  { value: 'comfortable', label: 'settings.addons.consent.presentation.comfortable' },
] as const satisfies ReadonlyArray<Option<string>>;
export const CONSENT_BUTTON_LAYOUTS = [
  { value: 'inline', label: 'settings.addons.consent.buttons.inline' },
  { value: 'stacked', label: 'settings.addons.consent.buttons.stacked' },
] as const satisfies ReadonlyArray<Option<string>>;

type ValueOf<O extends ReadonlyArray<{ value: string }>> = O[number]['value'];

/** The config value when it is one of the options, otherwise the add-on's default. */
function pick<O extends ReadonlyArray<{ value: string }>>(options: O, value: unknown, fallback: ValueOf<O>): ValueOf<O> {
  return options.find((option) => option.value === value)?.value ?? fallback;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

export type FeedbackValues = {
  placement: ValueOf<typeof FEEDBACK_PLACEMENTS>;
  presentation: ValueOf<typeof FEEDBACK_PRESENTATIONS>;
};

export function feedbackValues(config: Record<string, unknown>): FeedbackValues {
  const defaults = ADDON_REGISTRY.feedback.defaultConfig;
  return {
    placement: pick(FEEDBACK_PLACEMENTS, config.placement, defaults.placement),
    presentation: pick(FEEDBACK_PRESENTATIONS, config.presentation, defaults.presentation),
  };
}

export const feedbackConfig = (values: FeedbackValues): Record<string, unknown> => ({
  placement: values.placement,
  presentation: values.presentation,
});

export type UrlTemplateValues = { urlTemplate: string };

export const urlTemplateValues = (config: Record<string, unknown>): UrlTemplateValues => ({ urlTemplate: text(config.urlTemplate) });

/** What a URL template save sends: the template trimmed, or nothing when it is empty. */
export function urlTemplateConfig(values: UrlTemplateValues): Record<string, unknown> {
  const urlTemplate = values.urlTemplate.trim();
  return urlTemplate ? { urlTemplate } : {};
}

export type ConsentValues = {
  placement: ValueOf<typeof CONSENT_PLACEMENTS>;
  presentation: ValueOf<typeof CONSENT_PRESENTATIONS>;
  buttonLayout: ValueOf<typeof CONSENT_BUTTON_LAYOUTS>;
  /** Empty when the banner links to no privacy policy. */
  privacyPolicyUrl: string;
};

export function consentValues(config: Record<string, unknown>): ConsentValues {
  const defaults = ADDON_REGISTRY['consent-banner'].defaultConfig;
  return {
    placement: pick(CONSENT_PLACEMENTS, config.placement, defaults.placement),
    presentation: pick(CONSENT_PRESENTATIONS, config.presentation, defaults.presentation),
    buttonLayout: pick(CONSENT_BUTTON_LAYOUTS, config.buttonLayout, defaults.buttonLayout),
    privacyPolicyUrl: text(config.privacyPolicyUrl),
  };
}

/** What a consent save sends: the privacy address trimmed, and left out when empty. */
export function consentConfig(values: ConsentValues): Record<string, unknown> {
  const privacyPolicyUrl = values.privacyPolicyUrl.trim();
  return {
    placement: values.placement,
    presentation: values.presentation,
    buttonLayout: values.buttonLayout,
    ...(privacyPolicyUrl ? { privacyPolicyUrl } : {}),
  };
}

// ─── Address checks ─────────────────────────────────────────────────────────

/** The placeholders each URL template may use, as the server's config schema allows them. */
export const URL_TEMPLATE_PLACEHOLDERS = {
  'edit-suggestions': ['path', 'encodedPath'],
  'issue-links': ['url', 'path', 'encodedPath'],
} as const satisfies Partial<Record<AddonId, readonly string[]>>;

export type UrlTemplateAddonId = keyof typeof URL_TEMPLATE_PLACEHOLDERS;

export const isUrlTemplateAddon = (id: AddonId): id is UrlTemplateAddonId => Object.hasOwn(URL_TEMPLATE_PLACEHOLDERS, id);

export type UrlProblem = 'invalid' | 'unsupportedPlaceholder';

/**
 * What is wrong with a URL template, judged by the same schema the server
 * uses. Empty is fine (the add-on then needs configuration). A placeholder the
 * add-on doesn't fill is reported as such; anything else is an invalid address
 * (not http(s), credentials in it, too long).
 */
export function urlTemplateProblem(id: UrlTemplateAddonId, value: string): UrlProblem | undefined {
  const urlTemplate = value.trim();
  if (!urlTemplate) return undefined;
  const allowedPlaceholders: readonly string[] = URL_TEMPLATE_PLACEHOLDERS[id];
  const placeholders = [...urlTemplate.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1] ?? '');
  if (placeholders.some((name) => !allowedPlaceholders.includes(name))) return 'unsupportedPlaceholder';
  return addonConfigSchemas[id].safeParse({ urlTemplate }).success ? undefined : 'invalid';
}

/** What is wrong with the consent banner's privacy policy address: empty is fine; otherwise it must be an http(s) URL. */
export function privacyUrlProblem(value: string): 'invalid' | undefined {
  const privacyPolicyUrl = value.trim();
  if (!privacyPolicyUrl) return undefined;
  try {
    return addonConfigSchemas['consent-banner'].safeParse({ privacyPolicyUrl }).success ? undefined : 'invalid';
  } catch {
    // The schema's protocol check parses the address itself and throws on one that isn't a URL.
    return 'invalid';
  }
}

export const URL_PROBLEM_TEXT: Record<UrlProblem, MessageKey> = {
  invalid: 'settings.addons.url.invalid',
  unsupportedPlaceholder: 'settings.addons.url.unsupportedPlaceholder',
};

/**
 * The URL template field's copy per add-on. The hint and the example address
 * mention the placeholders themselves, so each is passed back as its own
 * parameter.
 */
export const URL_TEMPLATE_TEXT: Record<
  UrlTemplateAddonId,
  { label: MessageKey; hint: MessageKey; example: MessageKey; params: Record<string, string> }
> = {
  'edit-suggestions': {
    label: 'settings.addons.editUrl.label',
    hint: 'settings.addons.editUrl.hint',
    example: 'settings.addons.editUrl.placeholder',
    params: { path: '{path}' },
  },
  'issue-links': {
    label: 'settings.addons.issueUrl.label',
    hint: 'settings.addons.issueUrl.hint',
    example: 'settings.addons.issueUrl.placeholder',
    params: { url: '{url}', path: '{path}' },
  },
};
