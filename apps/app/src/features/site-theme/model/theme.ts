/**
 * Site configuration → Themes, as pure logic. One draft holds what the owner
 * authored for the site: `config.theme` (a preset plus optional colours,
 * layout, components and metadata) and the default appearance
 * (`config.styling.theme`). Styling owns the rest of `config.styling`
 * (`primaryColor`, `radius`); this form reads it for the preview and never
 * sends it. Rendered by `components/theme-settings.tsx`.
 */
import {
  MAX_THEME_TEMPLATE_BYTES,
  type NibleafThemeConfig,
  resolveTheme,
  THEME_PRESETS,
  THEME_SCHEMA_VERSION,
  type ThemeColorKey,
  type ThemeComponents,
  type ThemeContrastIssue,
  type ThemeLayout,
  type ThemePresetId,
  themeContrastIssues,
} from '@nibleaf/shared/themes';
import type { ProjectConfig, ProjectConfigUpdate } from '@nibleaf/validators';
import { deepEqual } from '@/lib/forms/server-draft';

export type Appearance = 'light' | 'dark' | 'system';
export type ColorMode = 'light' | 'dark';

/**
 * The draft. `theme` is the authored config exactly as stored (never the
 * resolved theme, never reader-shaded colours); unset stays `undefined` until
 * the owner edits it. `appearance` is `undefined` while the site has none
 * stored, which the reader and the control show as "system".
 */
export type ThemeValues = { theme: NibleafThemeConfig | undefined; appearance: Appearance | undefined };

/** The draft a site's stored config holds. Both keys are always present, so drafts compare key by key. */
export function themeValues(config: Pick<ProjectConfig, 'theme' | 'styling'> | null | undefined): ThemeValues {
  return { theme: config?.theme ?? undefined, appearance: config?.styling?.theme ?? undefined };
}

/** The appearance the control shows. */
export const shownAppearance = (values: ThemeValues): Appearance => values.appearance ?? 'system';

/**
 * The appearance a choice stores. "System" on a site that has none stored
 * keeps it unset, so looking at the control and choosing what it already
 * shows changes nothing. Once a site stores an appearance, "system" is stored
 * explicitly like the other two.
 */
export const chooseAppearance = (next: Appearance, baseline: ThemeValues): Appearance | undefined =>
  next === 'system' && baseline.appearance === undefined ? undefined : next;

/**
 * The project config the preview and the contrast check read: the stored
 * config with the draft in place of the two keys it owns. Styling's
 * `primaryColor` and `radius` still apply, as on the published site.
 */
export function previewConfig(config: ProjectConfig | null | undefined, values: ThemeValues): ProjectConfig {
  return { ...(config ?? {}), theme: values.theme, styling: { ...(config?.styling ?? {}), theme: values.appearance } };
}

/** A preset as the gallery and Reset apply it: every part of it, so the result looks exactly like its thumbnail. */
export function presetTheme(preset: ThemePresetId): NibleafThemeConfig {
  const definition = THEME_PRESETS[preset];
  return {
    version: THEME_SCHEMA_VERSION,
    preset,
    metadata: definition.metadata,
    colors: { light: { ...definition.colors.light }, dark: { ...definition.colors.dark } },
    layout: { ...definition.layout },
    components: { ...definition.components },
  };
}

/**
 * The authored theme an edit starts from. A site with no theme stored starts
 * from its preset's id and name only (what main seeded the draft with); no
 * resolved colour, layout or component is written into it.
 */
function editable(theme: NibleafThemeConfig | undefined, config: ProjectConfig | null | undefined): NibleafThemeConfig {
  if (theme) return theme;
  const resolved = resolveTheme({ styling: config?.styling });
  return { version: THEME_SCHEMA_VERSION, preset: resolved.id, metadata: resolved.metadata };
}

/** One authored colour token, in one mode. */
export function withColor(
  theme: NibleafThemeConfig | undefined,
  config: ProjectConfig | null | undefined,
  mode: ColorMode,
  key: ThemeColorKey,
  value: string,
): NibleafThemeConfig {
  const base = editable(theme, config);
  return { ...base, colors: { ...base.colors, [mode]: { ...base.colors?.[mode], [key]: value } } };
}

/** One authored layout or component option. */
export function withPart<S extends 'layout' | 'components'>(
  theme: NibleafThemeConfig | undefined,
  config: ProjectConfig | null | undefined,
  section: S,
  key: keyof (S extends 'layout' ? ThemeLayout : ThemeComponents),
  value: string,
): NibleafThemeConfig {
  const base = editable(theme, config);
  return { ...base, [section]: { ...base[section], [key]: value } };
}

const SECTIONS = ['colors', 'layout', 'components'] as const;

/**
 * The authored theme as a save sends it. The API merges `config.theme` one
 * level deep: each part sent replaces the stored one, and a part left out is
 * kept from the server. So that "Keep mine" over someone else's theme stores
 * the draft's look, not a mix:
 * - a colour, layout or component part the baseline has and the draft doesn't
 *   is sent empty (`{}`);
 * - a preset the baseline has and the draft doesn't is sent as the draft's
 *   effective preset (Harbor, the default), so another writer's preset never
 *   replaces it.
 * `version` and descriptive `metadata` the draft doesn't hold stay as stored
 * (neither changes how the site looks). Optional parts the baseline doesn't
 * have are never added.
 */
function sentTheme(theme: NibleafThemeConfig, baseline: NibleafThemeConfig | undefined): NibleafThemeConfig {
  const emptied = SECTIONS.filter((part) => baseline?.[part] !== undefined && theme[part] === undefined);
  const keepPreset = baseline?.preset !== undefined && theme.preset === undefined;
  if (emptied.length === 0 && !keepPreset) return theme;
  return {
    ...theme,
    ...(keepPreset ? { preset: resolveTheme({ theme }).id } : {}),
    ...Object.fromEntries(emptied.map((part) => [part, {}])),
  };
}

/**
 * The project config patch: only what changed from `baseline`, what the server
 * last confirmed for this draft. The theme is sent whole when the authored
 * theme changed; the appearance as `styling: { theme }` when it changed. The
 * rest of `config.styling` is never sent, so Styling's colour and radius stay
 * as the server holds them.
 */
export function themeConfigPatch(values: ThemeValues, baseline: ThemeValues): Pick<ProjectConfigUpdate, 'theme' | 'styling'> {
  const patch: Pick<ProjectConfigUpdate, 'theme' | 'styling'> = {};
  if (values.theme !== undefined && !deepEqual(values.theme, baseline.theme)) patch.theme = sentTheme(values.theme, baseline.theme);
  if (values.appearance !== undefined && values.appearance !== baseline.appearance) patch.styling = { theme: values.appearance };
  return patch;
}

/**
 * What a save of `values` stores, read back as the draft reads it: the draft
 * hook's `toSent`. A sent theme is merged one level deep over the baseline's,
 * as the API stores it, so the parts it keeps (`version`, `metadata`) are
 * part of what the save is judged by.
 */
export function sentThemeValues(values: ThemeValues, baseline: ThemeValues): ThemeValues {
  const sent = themeConfigPatch(values, baseline).theme;
  return { theme: sent ? { ...baseline.theme, ...sent } : values.theme, appearance: values.appearance };
}

/** The authored colours' contrast problems: what blocks a save (the API checks the same pairs). */
export const themeProblems = (config: ProjectConfig): ThemeContrastIssue[] => themeContrastIssues(resolveTheme(config, { authoredAccent: true }));

/** The colour tokens a contrast problem is about, e.g. `foreground` and `canvas`. */
export const problemTokens = (issue: ThemeContrastIssue) => issue.pair.split('/') as ThemeColorKey[];

/** Key of one colour input, for "was it left". */
export const tokenKey = (mode: ColorMode, key: ThemeColorKey) => `${mode}:${key}`;

/**
 * Undo history. Each entry is the draft before one edit, with the baseline it
 * was made against and, when it was made during a save, that save's id.
 *
 * An entry is usable only while the draft is still on that baseline: Undo
 * never brings back a value from before another writer's change, a refetch, an
 * accepted save or "Use theirs". The one exception is an edit made during a
 * save: once the server holds what that save sent (its echo, or its
 * response), entries made during it are still on the same footing, and stay.
 */
export type HistoryEntry = { values: ThemeValues; baseline: ThemeValues; save?: number; moved?: true };

/**
 * A save: the draft it was made from (`submitted`), and the baselines it can
 * leave the draft on (what it sent, then what the server answered).
 */
export type SaveMark = { id: number; submitted: ThemeValues; reached: ThemeValues[] };

export const HISTORY_LIMIT = 20;

export const recordHistory = (history: readonly HistoryEntry[], entry: HistoryEntry): HistoryEntry[] => [
  ...history.slice(-(HISTORY_LIMIT - 1)),
  entry,
];

export function usableHistory(history: readonly HistoryEntry[], baseline: ThemeValues, mark?: SaveMark): HistoryEntry[] {
  return history.filter(
    (entry) =>
      deepEqual(entry.baseline, baseline) ||
      (entry.save !== undefined && entry.save === mark?.id && mark.reached.some((reached) => deepEqual(reached, baseline))),
  );
}

/**
 * The history once the baseline has moved to `baseline`. Entries made on it
 * stay. Entries made during the save that reached it (its echo or its answer)
 * move onto it, so a later save that fails can't hide them. Moving keeps the
 * edits made during the save and takes the new baseline for every other key:
 * a key still as the save left it (as submitted, or as an earlier move set it)
 * takes what the server accepted, including someone else's value and the
 * server's normalization. Every other entry is retired for good: a server that
 * later returns to an old value never brings back the Undo made against it.
 */
export function settleHistory(history: HistoryEntry[], baseline: ThemeValues, mark?: SaveMark): HistoryEntry[] {
  let changed = false;
  const reached = Boolean(mark?.reached.some((value) => deepEqual(value, baseline)));
  const next = history.flatMap((entry): HistoryEntry[] => {
    const ofSave = reached && mark !== undefined && entry.save === mark.id;
    // An entry of that save is reconciled once, even one already on this
    // baseline (made after its echo): its snapshot still holds the draft's
    // values from before the server normalized them.
    if (deepEqual(entry.baseline, baseline) && (entry.moved || !ofSave)) return [entry];
    changed = true;
    if (!(ofSave && mark)) return [];
    const left = entry.moved ? entry.baseline : mark.submitted;
    const keys = ['theme', 'appearance'] as const;
    const values = Object.fromEntries(
      keys.map((key) => [key, deepEqual(entry.values[key], left[key]) ? baseline[key] : entry.values[key]]),
    ) as ThemeValues;
    return [{ ...entry, values, baseline, moved: true }];
  });
  return changed ? next : history;
}

/** The draft one Undo restores, and the history left after it; `undefined` when nothing usable is left. */
export function undoStep(history: readonly HistoryEntry[], baseline: ThemeValues, mark?: SaveMark) {
  const usable = usableHistory(history, baseline, mark);
  const last = usable.at(-1);
  return last ? { values: last.values, history: usable.slice(0, -1) } : undefined;
}

/** A pasted or chosen template, read as the server will: within its size limit, and valid JSON. */
export function readTemplateText(text: string): { template: unknown } | { error: 'tooLarge' | 'invalidJson' } {
  if (new TextEncoder().encode(text).byteLength > MAX_THEME_TEMPLATE_BYTES) return { error: 'tooLarge' };
  try {
    return { template: JSON.parse(text) as unknown };
  } catch {
    return { error: 'invalidJson' };
  }
}
