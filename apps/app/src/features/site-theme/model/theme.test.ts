import { MAX_THEME_TEMPLATE_BYTES, THEME_PRESETS } from '@nibleaf/shared/themes';
import { describe, expect, it } from 'vitest';
import {
  chooseAppearance,
  HISTORY_LIMIT,
  type HistoryEntry,
  presetTheme,
  previewConfig,
  problemTokens,
  readTemplateText,
  recordHistory,
  sentThemeValues,
  settleHistory,
  type ThemeValues,
  themeConfigPatch,
  themeProblems,
  themeValues,
  undoStep,
  usableHistory,
  withColor,
  withPart,
} from './theme';

const AUTHORED = { version: 1, preset: 'signal', colors: { light: { accent: '#5546e8' } } } as const;
const values = (theme: ThemeValues['theme'], appearance?: ThemeValues['appearance']): ThemeValues => ({ theme, appearance });

describe('the authored source', () => {
  it('reads the authored theme and appearance as stored, never the resolved theme', () => {
    expect(themeValues({ theme: AUTHORED, styling: { theme: 'dark', primaryColor: '#ff0000', radius: 'pill' } })).toStrictEqual({
      theme: AUTHORED,
      appearance: 'dark',
    });
  });

  it('keeps an unset theme and appearance unset, both keys present', () => {
    expect(themeValues(null)).toStrictEqual({ theme: undefined, appearance: undefined });
    expect(themeValues({ styling: { primaryColor: '#5546e8' } })).toStrictEqual({ theme: undefined, appearance: undefined });
  });

  it('previews with Styling’s colour and radius still applied, and the draft in place of the two keys it owns', () => {
    const config = { styling: { primaryColor: '#5546e8', radius: 'pill' as const, theme: 'light' as const }, seo: { metaTitle: 'Docs' } };
    expect(previewConfig(config, values(AUTHORED, 'dark'))).toStrictEqual({
      styling: { primaryColor: '#5546e8', radius: 'pill', theme: 'dark' },
      seo: { metaTitle: 'Docs' },
      theme: AUTHORED,
    });
  });
});

describe('edits', () => {
  it('a preset carries every part of it', () => {
    expect(presetTheme('manuscript')).toStrictEqual({
      version: 1,
      preset: 'manuscript',
      metadata: THEME_PRESETS.manuscript.metadata,
      colors: { light: THEME_PRESETS.manuscript.colors.light, dark: THEME_PRESETS.manuscript.colors.dark },
      layout: THEME_PRESETS.manuscript.layout,
      components: THEME_PRESETS.manuscript.components,
    });
  });

  it('a colour edit on an authored theme adds that one token and keeps every other authored part as it was', () => {
    const theme = { ...AUTHORED, metadata: { name: 'Mine', description: 'Kept', author: 'Ada' }, layout: { shell: 'console' as const } };
    expect(withColor(theme, null, 'dark', 'canvas', '#000000')).toStrictEqual({
      ...theme,
      colors: { light: { accent: '#5546e8' }, dark: { canvas: '#000000' } },
    });
  });

  it('an edit on an unset theme starts from the preset’s id and name only, no resolved colour or layout', () => {
    expect(withPart(undefined, { styling: { primaryColor: '#5546e8', radius: 'pill' } }, 'layout', 'density', 'compact')).toStrictEqual({
      version: 1,
      preset: 'harbor',
      metadata: THEME_PRESETS.harbor.metadata,
      layout: { density: 'compact' },
    });
  });

  it('"System" on a site with no stored appearance stays unset; once one is stored it is explicit', () => {
    expect(chooseAppearance('system', values(undefined))).toBeUndefined();
    expect(chooseAppearance('dark', values(undefined))).toBe('dark');
    expect(chooseAppearance('system', values(undefined, 'dark'))).toBe('system');
  });
});

describe('the changed-field patch', () => {
  const baseline = values(AUTHORED, 'dark');

  it('sends nothing when nothing changed', () => {
    expect(themeConfigPatch(baseline, baseline)).toStrictEqual({});
  });

  it('sends the theme alone when only the theme changed, and never Styling’s colour or radius', () => {
    const theme = withColor(AUTHORED, null, 'light', 'canvas', '#fffff0');
    expect(themeConfigPatch(values(theme, 'dark'), baseline)).toStrictEqual({ theme });
  });

  it('sends `styling: { theme }` alone when only the appearance changed, including an explicit return to system', () => {
    expect(themeConfigPatch(values(AUTHORED, 'light'), baseline)).toStrictEqual({ styling: { theme: 'light' } });
    expect(themeConfigPatch(values(AUTHORED, 'system'), baseline)).toStrictEqual({ styling: { theme: 'system' } });
  });

  it('an unset appearance is never sent, and an unset theme never is', () => {
    expect(themeConfigPatch(values(undefined, undefined), values(undefined, undefined))).toStrictEqual({});
    expect(themeConfigPatch(values(AUTHORED, undefined), values(undefined, undefined))).toStrictEqual({ theme: AUTHORED });
  });

  it('a part the baseline holds and the kept draft doesn’t is sent empty, so the site stores the draft’s theme, not a mix', () => {
    const theirs = { ...AUTHORED, layout: { shell: 'console' as const }, components: { tabs: 'pills' as const } };
    const mine = { version: 1 as const, preset: 'harbor' as const, colors: { light: { canvas: '#fffff0' } } };
    expect(themeConfigPatch(values(mine), values(theirs))).toStrictEqual({ theme: { ...mine, layout: {}, components: {} } });
    expect(sentThemeValues(values(mine, 'dark'), values(theirs))).toStrictEqual(values({ ...mine, layout: {}, components: {} }, 'dark'));
  });

  it('a legacy theme without a preset keeps its effective preset over another writer’s (Keep mine)', () => {
    const mine = { version: 1 as const, colors: { light: { canvas: '#fafafa' } } };
    const theirs = {
      version: 1 as const,
      preset: 'signal' as const,
      colors: { light: { canvas: '#fdfdfd' } },
      metadata: { name: 'Theirs', description: 'Kept' },
    };
    expect(themeConfigPatch(values(mine), values(theirs))).toStrictEqual({ theme: { ...mine, preset: 'harbor' } });
    // Stored as the API merges it one level deep: the descriptive metadata stays.
    expect(sentThemeValues(values(mine), values(theirs))).toStrictEqual(values({ ...theirs, ...mine, preset: 'harbor' }));
    // Without a baseline preset nothing is added.
    expect(themeConfigPatch(values(mine), values({ version: 1, colors: {} }))).toStrictEqual({ theme: mine });
  });

  it('`toSent` is the stored shape: unchanged values are what the baseline already holds', () => {
    expect(sentThemeValues(baseline, baseline)).toStrictEqual(baseline);
  });
});

describe('Undo history', () => {
  const B0 = values(AUTHORED, 'dark');
  const B1 = values({ ...AUTHORED, preset: 'harbor' }, 'dark');
  const entry = (n: number, baseline = B0, save?: number): HistoryEntry => ({
    values: values({ ...AUTHORED, layout: { density: n % 2 ? 'compact' : 'relaxed' } }, 'dark'),
    baseline,
    save,
  });

  it('keeps the last 20 edits', () => {
    let history: HistoryEntry[] = [];
    for (let n = 0; n < 25; n += 1) history = recordHistory(history, entry(n));
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history[0]).toStrictEqual(entry(5));
  });

  it('undoes on the same baseline, newest first', () => {
    const history = [entry(1), entry(2)];
    expect(undoStep(history, B0)).toStrictEqual({ values: entry(2).values, history: [entry(1)] });
  });

  it('never undoes across a new baseline: a refetch, someone else’s save, or an accepted save', () => {
    expect(usableHistory([entry(1), entry(2)], B1)).toStrictEqual([]);
    expect(undoStep([entry(1)], B1)).toBeUndefined();
  });

  it('after a save, retires the edits made before it and keeps the ones made during it', () => {
    const sent = values(AUTHORED, 'light');
    const history = [entry(1), entry(2, B0, 7), entry(3, sent, 7)];
    // The save's echo or response put the baseline on what it sent.
    expect(usableHistory(history, sent, { id: 7, reached: [sent] })).toStrictEqual([entry(2, B0, 7), entry(3, sent, 7)]);
    // Another save's mark keeps nothing from save 7 unless it is on its own baseline.
    expect(usableHistory(history, sent, { id: 8, reached: [sent] })).toStrictEqual([entry(3, sent, 7)]);
    // A failed save leaves the baseline where it was: everything stays usable.
    expect(usableHistory(history, B0, { id: 7, reached: [sent] })).toStrictEqual([entry(1), entry(2, B0, 7)]);
  });
});

describe('settling Undo when the baseline moves', () => {
  const A = values(AUTHORED, 'dark');
  const B = values({ ...AUTHORED, preset: 'harbor' }, 'dark');
  const edit = (n: number, baseline: ThemeValues, save?: number): HistoryEntry => ({
    values: values({ ...AUTHORED, layout: { density: n % 2 ? 'compact' : 'relaxed' } }, 'light'),
    baseline,
    save,
  });

  it('retires entries a server change overtakes for good: A → B → A brings none back', () => {
    const history = [edit(1, A), edit(2, A)];
    const onB = settleHistory(history, B);
    expect(onB).toStrictEqual([]);
    expect(settleHistory(onB, A)).toStrictEqual([]);
    expect(settleHistory(history, A)).toBe(history);
  });

  it('moves edits made during a save onto the baseline it reached, so a failed retry keeps them', () => {
    const sent = values(AUTHORED, 'light');
    const history = [edit(1, A), edit(2, A, 7)];
    const saved = settleHistory(history, sent, { id: 7, reached: [sent] });
    expect(saved).toStrictEqual([edit(2, sent, 7)]);
    // A second save (id 8) fails: the baseline stays, so the moved entry stays usable.
    expect(usableHistory(saved, sent, { id: 8, reached: [values(AUTHORED, 'system')] })).toStrictEqual(saved);
    // The server's answer differing from what was sent moves it once more.
    const answered = values({ ...AUTHORED, metadata: { name: 'Normalized', description: 'By the server' } }, 'light');
    expect(settleHistory(saved, answered, { id: 7, reached: [sent, answered] })).toStrictEqual([edit(2, answered, 7)]);
  });
});

describe('validation and templates', () => {
  it('reports the authored colours’ contrast problems by token, ignoring the reader’s shaded accent', () => {
    const failing = previewConfig(null, values(withColor(undefined, null, 'light', 'foreground', '#eeeeee')));
    const issues = themeProblems(failing);
    expect(issues.map((issue) => `${issue.mode}:${issue.pair}`)).toContain('light:foreground/canvas');
    expect(problemTokens(issues[0] as (typeof issues)[number])).toStrictEqual(['foreground', 'canvas']);
    // A brand accent that only fails as text is shaded for readers, not a save problem (PUB-006).
    expect(themeProblems(previewConfig(null, values({ version: 1, preset: 'harbor', colors: { light: { accent: '#b96a3d' } } })))).toStrictEqual([]);
    expect(themeProblems(previewConfig(null, values(presetTheme('signal'))))).toStrictEqual([]);
  });

  it('reads template text within the size limit as JSON', () => {
    expect(readTemplateText('{"kind":"nibleaf-theme"}')).toStrictEqual({ template: { kind: 'nibleaf-theme' } });
    expect(readTemplateText('{nope')).toStrictEqual({ error: 'invalidJson' });
    expect(readTemplateText(`"${'x'.repeat(MAX_THEME_TEMPLATE_BYTES)}"`)).toStrictEqual({ error: 'tooLarge' });
  });
});
