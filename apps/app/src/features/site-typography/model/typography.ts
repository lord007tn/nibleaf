/**
 * Site configuration → Typography, as pure logic: the six values the form
 * edits, the reading-style presets, which preset the values match, what a save
 * sends and the preview's typeset variables. Rendered by
 * `components/typography-settings.tsx`; tested in `typography.test.ts`.
 */

/** The fonts each picker offers. A site may also hold a name outside these; see `fontOptions`. */
const FONT_CATALOG = {
  headingFont: ['Geist', 'Inter', 'Söhne', 'IBM Plex Sans', 'System UI'],
  bodyFont: ['Geist', 'Inter', 'Source Sans 3', 'System UI'],
  codeFont: ['Geist Mono', 'JetBrains Mono', 'IBM Plex Mono', 'Fira Code'],
} as const;
export type FontField = keyof typeof FONT_CATALOG;
const FONT_FIELDS = Object.keys(FONT_CATALOG) as FontField[];

/** The steps the schema allows for each rhythm value (`config.typography`). */
export const RHYTHM_STEPS = {
  baseSize: ['14', '15', '16', '17', '18'],
  leading: ['1.5', '1.6', '1.75', '1.9', '2'],
  flow: ['0.75', '1', '1.25', '1.5', '2'],
} as const;
export type RhythmField = keyof typeof RHYTHM_STEPS;
const RHYTHM_FIELDS = Object.keys(RHYTHM_STEPS) as RhythmField[];

type BaseSize = (typeof RHYTHM_STEPS.baseSize)[number];
type Leading = (typeof RHYTHM_STEPS.leading)[number];
export type Flow = (typeof RHYTHM_STEPS.flow)[number];
type Rhythm = { baseSize: BaseSize; leading: Leading; flow: Flow };

/** Everything the Typography form edits, so "dirty" has one meaning. */
export type TypographyValues = Record<FontField, string> & Rhythm;

/** What a site that never set typography reads with. */
export const TYPOGRAPHY_DEFAULTS: TypographyValues = {
  headingFont: 'Geist',
  bodyFont: 'Geist',
  codeFont: 'Geist Mono',
  baseSize: '16',
  leading: '1.75',
  flow: '1.25',
};

/**
 * One-click reading styles. A preset is only a (size, leading, flow) triple:
 * applying one sets those three values, and the stored config holds the
 * values, never the preset's name.
 */
export const PRESETS = {
  default: { baseSize: '16', leading: '1.75', flow: '1.25' },
  compact: { baseSize: '15', leading: '1.6', flow: '1' },
  relaxed: { baseSize: '16', leading: '1.9', flow: '1.5' },
  article: { baseSize: '17', leading: '2', flow: '1.5' },
} as const satisfies Record<string, Rhythm>;
type PresetName = keyof typeof PRESETS;
export const PRESET_NAMES = Object.keys(PRESETS) as PresetName[];

/** `config.typography` as the API stores it: any field may be missing. */
type TypographyConfigLike = Partial<Record<FontField | RhythmField, string | null>>;

const isStep = <F extends RhythmField>(field: F, value: unknown): value is Rhythm[F] => (RHYTHM_STEPS[field] as readonly unknown[]).includes(value);

/**
 * The form's values for a site's config. A font keeps whatever name the site
 * stored (trimmed), even one outside the catalog; a blank or missing font, and
 * a missing or unknown rhythm step, read as the default.
 */
export function typographyValues(config: { typography?: TypographyConfigLike | null } | null | undefined): TypographyValues {
  const stored = config?.typography ?? {};
  const font = (field: FontField) => stored[field]?.trim() || TYPOGRAPHY_DEFAULTS[field];
  const step = <F extends RhythmField>(field: F): Rhythm[F] => {
    const value = stored[field];
    return isStep(field, value) ? value : TYPOGRAPHY_DEFAULTS[field];
  };
  return {
    headingFont: font('headingFont'),
    bodyFont: font('bodyFont'),
    codeFont: font('codeFont'),
    baseSize: step('baseSize'),
    leading: step('leading'),
    flow: step('flow'),
  };
}

/** The fonts a picker lists: its catalog, then the site's current name if the catalog lacks it. */
export function fontOptions(field: FontField, current: string): string[] {
  const catalog: readonly string[] = FONT_CATALOG[field];
  return current && !catalog.includes(current) ? [...catalog, current] : [...catalog];
}

/** The preset whose triple the values hold, if any. */
export function activePreset(values: Rhythm): PresetName | undefined {
  return PRESET_NAMES.find((name) => RHYTHM_FIELDS.every((field) => PRESETS[name][field] === values[field]));
}

/** The values with a preset's triple applied; the fonts are untouched. */
export function applyPreset<T extends Rhythm>(values: T, name: PresetName): T {
  return { ...values, ...PRESETS[name] };
}

/** The `config.typography` patch a save sends. */
type TypographyUpdate = Partial<TypographyValues>;

/**
 * The typography patch for the change from `baseline` to `submitted`.
 *
 * The API merges `config.typography` one level deep, so a field left out keeps
 * its stored value and every other config section is untouched. Only fields
 * that changed are sent, so a save never writes back a stale copy of a value
 * someone else changed, and a site that never set a value keeps reading the
 * default until someone picks one.
 */
export function typographyUpdate(baseline: TypographyValues, submitted: TypographyValues): TypographyUpdate {
  const changed = [...FONT_FIELDS, ...RHYTHM_FIELDS].filter((field) => baseline[field] !== submitted[field]);
  return Object.fromEntries(changed.map((field) => [field, submitted[field]]));
}

/**
 * The live preview's style: the typeset variables the published site reads,
 * from the draft's values. Nothing is loaded; a font the browser lacks falls
 * back to the theme's family.
 */
export function previewStyle(values: TypographyValues): Record<string, string> {
  return {
    fontSize: `${values.baseSize}px`,
    '--typeset-leading': values.leading,
    '--typeset-flow': `${values.flow}em`,
    '--typeset-font-body': `'${values.bodyFont}', var(--font-sans, system-ui, sans-serif)`,
    '--typeset-font-heading': `'${values.headingFont}', var(--font-sans, sans-serif)`,
    '--typeset-font-mono': `'${values.codeFont}', var(--font-mono, monospace)`,
  };
}
