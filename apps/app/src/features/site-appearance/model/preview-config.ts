import type { ProjectConfig } from '@nibleaf/validators';
import { type StylingValues, stylingPatch } from '@/features/site-styling/model/styling';
import { previewConfig, type ThemeValues } from '@/features/site-theme/model/theme';
import { type TypographyValues, typographyUpdate } from '@/features/site-typography/model/typography';

/**
 * The unsaved drafts the Appearance page's live preview shows
 * (operations/ui-overhaul.md §5.7, B5). Each form that changes how the site
 * looks publishes its draft here while it is mounted; the preview reads all of
 * them, so a colour, a corner radius, a theme or a font shows before Save, and
 * together. Nothing here is saved: the forms own their drafts.
 *
 * A draft is published with the baseline it was made against, so the preview
 * applies only what the person changed (what a save would send) and an unset
 * value keeps reading the theme's default, as the published site does.
 */
export type AppearanceDrafts = {
  theme?: ThemeValues;
  styling?: { values: StylingValues; baseline: StylingValues };
  typography?: { values: TypographyValues; baseline: TypographyValues };
};

/**
 * The config the preview renders: the stored config with every draft applied,
 * as the published site would read it once saved. Text that is not a colour
 * yet keeps the stored colour.
 */
export function previewWithDrafts(config: ProjectConfig | null | undefined, drafts: AppearanceDrafts): ProjectConfig {
  let next: ProjectConfig = { ...(config ?? {}) };
  if (drafts.theme) next = previewConfig(next, drafts.theme);
  if (drafts.styling) {
    const { values, baseline } = drafts.styling;
    const styling = { ...(next.styling ?? {}), ...stylingPatch(values, baseline) };
    // Clearing the colour (back to none) or the radius (back to the theme's) is a draft too.
    if (values.primaryColor === '' && baseline.primaryColor !== '') delete styling.primaryColor;
    if (values.radius === '' && baseline.radius !== '') delete styling.radius;
    next = { ...next, styling };
  }
  if (drafts.typography) {
    const { values, baseline } = drafts.typography;
    next = { ...next, typography: { ...(next.typography ?? {}), ...typographyUpdate(baseline, values) } };
  }
  return next;
}
