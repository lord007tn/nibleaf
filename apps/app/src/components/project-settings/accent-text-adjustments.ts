import { contrastRatio, type ResolvedTheme, safeThemeHex } from '@nibleaf/shared/themes';

export interface AccentTextAdjustment {
  mode: 'light' | 'dark';
  from: string;
  fromRatio: number;
  to: string;
  toRatio: number;
}

/** Where the published site draws the accent darker or lighter than authored,
 * so links and buttons pass AA: shown beside the theme's colours. Takes the
 * theme resolved as authored (`resolveTheme(config, { authoredAccent: true })`)
 * and as published (`resolveTheme(config)`). It lives with the dashboard, its
 * only user, so the shared themes chunk every page loads doesn't carry it. */
export const accentTextAdjustments = (authored: ResolvedTheme, applied: ResolvedTheme): AccentTextAdjustment[] =>
  (['light', 'dark'] as const).flatMap((mode) => {
    const from = safeThemeHex(authored.colors[mode].accent, authored.colors[mode].accent);
    const to = applied.colors[mode].accent;
    if (from === to) return [];
    const canvas = applied.colors[mode].canvas;
    return [{ mode, from, fromRatio: contrastRatio(from, canvas), to, toRatio: contrastRatio(to, canvas) }];
  });
