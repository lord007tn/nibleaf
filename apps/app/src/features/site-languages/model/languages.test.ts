import { describe, expect, it } from 'vitest';
import {
  addLanguageDecision,
  coverageSummary,
  isShownOnSite,
  languageDir,
  languageRowActions,
  languagesAccess,
  NO_PENDING_WRITES,
  orderLanguages,
  showsWriteControls,
} from './languages';

const english = { id: 'en', isDefault: true, enabled: true, direction: 'LTR' as const, position: 0 };
const arabic = { id: 'ar', isDefault: false, enabled: true, direction: 'RTL' as const, position: 2 };
const french = { id: 'fr', isDefault: false, enabled: false, direction: 'LTR' as const, position: 1 };

describe('orderLanguages', () => {
  it('puts the default language first, then the configured position', () => {
    expect(orderLanguages([arabic, french, english]).map((language) => language.id)).toEqual(['en', 'fr', 'ar']);
  });
});

describe('row facts', () => {
  it('treats a row without the serving flag as shown', () => {
    expect(isShownOnSite({})).toBe(true);
    expect(isShownOnSite({ enabled: false })).toBe(false);
  });

  it("takes the language's own direction", () => {
    expect(languageDir(arabic)).toBe('rtl');
    expect(languageDir(english)).toBe('ltr');
  });
});

describe('languagesAccess', () => {
  it.each([
    ['edit', 'manage', true],
    ['viewOnly', 'readOnly', false],
    ['pending', 'locked', true],
    ['unknown', 'unknown', true],
  ] as const)('%s → %s', (edit, access, writeControls) => {
    expect(languagesAccess(edit)).toBe(access);
    expect(showsWriteControls(languagesAccess(edit))).toBe(writeControls);
  });

  it('locks Add language unless the person can manage languages', () => {
    expect(addLanguageDecision('manage')).toEqual({ state: 'allowed' });
    expect(addLanguageDecision('locked')).toEqual({ state: 'locked' });
    expect(addLanguageDecision('unknown')).toEqual({ state: 'locked' });
  });
});

describe('languageRowActions', () => {
  it('allows every action on a shown, non-default language', () => {
    expect(languageRowActions(arabic, 'manage')).toEqual({
      makeDefault: { state: 'allowed' },
      visibility: { state: 'allowed', next: 'hide' },
      remove: { state: 'allowed' },
    });
  });

  it('offers to show a hidden language, and still lets it become the default (the server shows it again)', () => {
    const actions = languageRowActions(french, 'manage');
    expect(actions.visibility).toEqual({ state: 'allowed', next: 'show' });
    expect(actions.makeDefault).toEqual({ state: 'allowed' });
  });

  it('says why the default language cannot be made default, hidden or deleted', () => {
    expect(languageRowActions(english, 'manage')).toEqual({
      makeDefault: { state: 'disabled', reason: 'alreadyDefault' },
      visibility: { state: 'disabled', reason: 'defaultAlwaysShown', next: 'hide' },
      remove: { state: 'disabled', reason: 'defaultCantBeDeleted' },
    });
  });

  it.each(['locked', 'unknown', 'readOnly'] as const)('locks every action with no reason when access is %s', (access) => {
    const actions = languageRowActions(arabic, access);
    expect(actions.makeDefault).toEqual({ state: 'locked' });
    expect(actions.visibility).toEqual({ state: 'locked', next: 'hide' });
    expect(actions.remove).toEqual({ state: 'locked' });
  });

  it('while a default change runs, locks every Make default and the rows it touches', () => {
    const pending = { ...NO_PENDING_WRITES, defaultTo: 'ar' };
    expect(languageRowActions(french, 'manage', pending)).toEqual({
      makeDefault: { state: 'disabled', reason: 'saving' },
      visibility: { state: 'allowed', next: 'show' },
      remove: { state: 'allowed' },
    });
    expect(languageRowActions(arabic, 'manage', pending)).toEqual({
      makeDefault: { state: 'disabled', reason: 'saving' },
      visibility: { state: 'disabled', reason: 'saving', next: 'hide' },
      remove: { state: 'disabled', reason: 'saving' },
    });
    // The current default keeps its own reasons: they stay true until the change lands.
    expect(languageRowActions(english, 'manage', pending).makeDefault).toEqual({ state: 'disabled', reason: 'alreadyDefault' });
  });

  it('locks only the row whose show/hide request is running', () => {
    const pending = { ...NO_PENDING_WRITES, visibility: ['ar'] };
    expect(languageRowActions(arabic, 'manage', pending).visibility).toEqual({ state: 'disabled', reason: 'saving', next: 'hide' });
    expect(languageRowActions(arabic, 'manage', pending).makeDefault).toEqual({ state: 'allowed' });
    expect(languageRowActions(french, 'manage', pending).visibility).toEqual({ state: 'allowed', next: 'show' });
  });

  it('locks a row that is being deleted', () => {
    const actions = languageRowActions(arabic, 'manage', { ...NO_PENDING_WRITES, removing: ['ar'] });
    expect(actions.makeDefault).toEqual({ state: 'disabled', reason: 'saving' });
    expect(actions.visibility).toEqual({ state: 'disabled', reason: 'saving', next: 'hide' });
    expect(actions.remove).toEqual({ state: 'disabled', reason: 'saving' });
  });
});

describe('coverageSummary', () => {
  const coverage = { pageCount: 4, sourcePageCount: 10, matchedPages: 4, missingPages: 6, extraPages: 1, percentage: 40 };

  it('says nothing without coverage', () => {
    expect(coverageSummary({ isDefault: false })).toBeNull();
    expect(coverageSummary({ isDefault: false, coverage: null })).toBeNull();
  });

  it('counts the source pages for the default language', () => {
    expect(coverageSummary({ isDefault: true, coverage: { ...coverage, pageCount: 10, missingPages: 0, extraPages: 0 } })).toEqual({
      kind: 'source',
      pageCount: 10,
      missing: 0,
      extra: 0,
    });
  });

  it('has nothing to compare when the default language has no pages', () => {
    expect(coverageSummary({ isDefault: false, coverage: { ...coverage, sourcePageCount: 0, percentage: null } })).toEqual({
      kind: 'noSource',
      missing: 6,
      extra: 1,
    });
  });

  it.each([
    [100, 'complete'],
    [40, 'partial'],
    [0, 'none'],
    [null, 'partial'],
  ] as const)('compares a translation at %s%% as %s', (percentage, tone) => {
    expect(coverageSummary({ isDefault: false, coverage: { ...coverage, percentage } })).toEqual({
      kind: 'compared',
      matched: 4,
      total: 10,
      percentage,
      tone,
      missing: 6,
      extra: 1,
    });
  });
});
