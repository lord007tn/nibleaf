import { describe, expect, it } from 'vitest';
import {
  aiAnswersControl,
  DEFAULT_MAX_RESULTS_RANGE,
  decisionProps,
  distributionText,
  fieldsDecision,
  HEALTH,
  issueBadge,
  maxResultsProblem,
  normalizeSearch,
  readOnlyNote,
  reindexDecision,
  type SearchConfigurationLike,
  samplePager,
  searchSaveRequests,
  searchValues,
  startersProblem,
  supportUrlProblem,
} from './search';

const configuration: SearchConfigurationLike = {
  maxResults: 12,
  versionFilterEnabled: true,
  aiAnswers: false,
  aiConversationCapture: true,
  aiStarterQuestions: ['How do I start?', 'Where are the keys?'],
  aiSupportUrl: undefined,
  hotkey: 'cmdk',
  placeholder: null,
};

const languages = [
  { id: 'ar', isDefault: false, position: 2, config: { search: { placeholder: 'ابحث' } } },
  { id: 'en', isDefault: true, position: 0, config: null },
  { id: 'fr', isDefault: false, position: 1 },
];

describe('searchValues', () => {
  it('reads the configuration and every non-default language, in language order', () => {
    const values = searchValues(configuration, languages);
    expect(values).toEqual({
      placeholder: '',
      maxResults: '12',
      hotkey: 'cmdk',
      versionFilterEnabled: true,
      aiAnswers: false,
      aiConversationCapture: true,
      aiStarterQuestions: 'How do I start?\nWhere are the keys?',
      aiSupportUrl: '',
      languagePlaceholders: { fr: '', ar: 'ابحث' },
    });
    expect(Object.keys(values.languagePlaceholders)).toEqual(['fr', 'ar']);
  });

  it('normalizes text the way the server stores it', () => {
    const values = searchValues(configuration, languages);
    expect(
      normalizeSearch({
        ...values,
        placeholder: '  Find  ',
        maxResults: ' 20 ',
        aiStarterQuestions: '  One?\n\n Two? \n',
        aiSupportUrl: ' https://help.example.com ',
        languagePlaceholders: { fr: ' Chercher ', ar: '' },
      }),
    ).toMatchObject({
      placeholder: 'Find',
      maxResults: '20',
      aiStarterQuestions: 'One?\nTwo?',
      aiSupportUrl: 'https://help.example.com',
      languagePlaceholders: { fr: 'Chercher', ar: '' },
    });
  });
});

describe('validation', () => {
  it('explains a result limit outside the range instead of clamping it', () => {
    const range = { min: 1, max: 50 };
    expect(maxResultsProblem('12', range)).toBeUndefined();
    expect(maxResultsProblem('1', range)).toBeUndefined();
    expect(maxResultsProblem('50', range)).toBeUndefined();
    expect(maxResultsProblem('0', range)).toBe('range');
    expect(maxResultsProblem('51', range)).toBe('range');
    expect(maxResultsProblem('', range)).toBe('range');
    expect(maxResultsProblem('2.5', range)).toBe('range');
    expect(maxResultsProblem('-3', range)).toBe('range');
  });

  it('falls back to the shared range, whose default is the named 12', () => {
    expect(DEFAULT_MAX_RESULTS_RANGE).toEqual({ default: 12, min: 1, max: 50 });
    expect(maxResultsProblem('50')).toBeUndefined();
    expect(maxResultsProblem('51')).toBe('range');
  });

  it('checks suggested questions by the server rule, ignoring blank lines', () => {
    expect(startersProblem('')).toBeUndefined();
    expect(startersProblem('How do I start?\n\nWhere are the keys?')).toBeUndefined();
    expect(startersProblem('Hi')).toBe('invalid');
    expect(startersProblem('One?\nTwo?\nThree?\nFour?\nFive?')).toBe('invalid');
    expect(startersProblem('x'.repeat(121))).toBe('invalid');
  });

  it('allows an empty support link, https links and mailto addresses', () => {
    expect(supportUrlProblem('')).toBeUndefined();
    expect(supportUrlProblem('   ')).toBeUndefined();
    expect(supportUrlProblem('https://help.example.com')).toBeUndefined();
    expect(supportUrlProblem('mailto:help@example.com')).toBeUndefined();
    expect(supportUrlProblem('javascript:alert(1)')).toBe('invalid');
    expect(supportUrlProblem('help.example.com')).toBe('invalid');
  });
});

describe('searchSaveRequests', () => {
  const baseline = searchValues(configuration, languages);

  it('sends nothing when nothing changed, even with stray whitespace', () => {
    expect(searchSaveRequests(baseline, { ...baseline, aiStarterQuestions: `${baseline.aiStarterQuestions}\n` })).toEqual({
      configuration: null,
      languages: [],
    });
  });

  it('sends only the configuration fields that changed, as the server takes them', () => {
    const { configuration: patch } = searchSaveRequests(baseline, {
      ...baseline,
      maxResults: '20',
      hotkey: 'slash',
      aiStarterQuestions: 'One?\n\nTwo?',
      aiSupportUrl: ' mailto:help@example.com ',
    });
    expect(patch).toEqual({
      maxResults: 20,
      hotkey: 'slash',
      aiStarterQuestions: ['One?', 'Two?'],
      aiSupportUrl: 'mailto:help@example.com',
    });
  });

  it('clears an emptied placeholder and support link with null', () => {
    const before = { ...baseline, placeholder: 'Find', aiSupportUrl: 'https://help.example.com' };
    expect(searchSaveRequests(before, { ...before, placeholder: '  ', aiSupportUrl: '' }).configuration).toEqual({
      placeholder: null,
      aiSupportUrl: null,
    });
  });

  it('sends one language update per changed placeholder; an emptied one clears the override', () => {
    const { configuration: patch, languages: updates } = searchSaveRequests(baseline, {
      ...baseline,
      languagePlaceholders: { fr: ' Chercher ', ar: '' },
    });
    expect(patch).toBeNull();
    expect(updates).toEqual([
      { id: 'fr', placeholder: 'Chercher' },
      { id: 'ar', placeholder: null },
    ]);
  });
});

describe('access', () => {
  it('locks the form unless the person is an Admin, and explains only a definite no', () => {
    expect(fieldsDecision('admin')).toEqual({ kind: 'allowed' });
    expect(fieldsDecision('pending')).toEqual({ kind: 'locked' });
    expect(fieldsDecision('notAdmin')).toEqual({ kind: 'locked' });
    expect(readOnlyNote('notAdmin')).toBe('settings.permissions.body');
    expect(readOnlyNote('pending')).toBeNull();
    expect(readOnlyNote('admin')).toBeNull();
  });

  it('turns the decision into control props', () => {
    expect(decisionProps({ kind: 'allowed' })).toEqual({ disabled: false });
    expect(decisionProps({ kind: 'locked' })).toEqual({ disabled: true });
    expect(decisionProps({ kind: 'denied', reason: 'common.saving' })).toEqual({ disabled: true, reason: 'common.saving' });
  });
});

describe('aiAnswersControl', () => {
  it('can be turned on with a working AI connection', () => {
    expect(aiAnswersControl('available', false, 'admin')).toEqual({ decision: { kind: 'allowed' }, note: null, linkToSmartAi: false });
  });

  it('says what is missing, and links to Smart AI when the site can fix it', () => {
    expect(aiAnswersControl('needsConnection', false, 'admin')).toEqual({
      decision: { kind: 'denied', reason: 'settings.search.aiAnswers.needsConnection' },
      note: null,
      linkToSmartAi: true,
    });
    expect(aiAnswersControl('needsServer', false, 'admin')).toEqual({
      decision: { kind: 'denied', reason: 'settings.search.aiAnswers.needsServer' },
      note: null,
      linkToSmartAi: false,
    });
  });

  it('can always be turned off once on, with the missing piece as a note', () => {
    expect(aiAnswersControl('needsConnection', true, 'admin')).toEqual({
      decision: { kind: 'allowed' },
      note: 'settings.search.aiAnswers.needsConnection',
      linkToSmartAi: true,
    });
    expect(aiAnswersControl('pending', true, 'admin').decision).toEqual({ kind: 'allowed' });
  });

  it('stays locked without a word while unknown or for non-Admins', () => {
    expect(aiAnswersControl('pending', false, 'admin').decision).toEqual({ kind: 'locked' });
    expect(aiAnswersControl('available', true, 'pending')).toEqual({ decision: { kind: 'locked' }, note: null, linkToSmartAi: false });
    expect(aiAnswersControl('needsConnection', false, 'notAdmin')).toEqual({ decision: { kind: 'locked' }, note: null, linkToSmartAi: false });
  });
});

describe('index health', () => {
  const ready = { availability: { reason: null }, health: 'ready' as const };

  it('allows Reindex for Admins once the index state is known, and when the provider is down', () => {
    expect(reindexDecision(ready, 'admin')).toEqual({ kind: 'allowed' });
    expect(reindexDecision({ availability: { reason: 'provider_unavailable' }, health: 'unavailable' }, 'admin')).toEqual({ kind: 'allowed' });
    expect(reindexDecision({ availability: { reason: null }, health: 'failed' }, 'admin')).toEqual({ kind: 'allowed' });
  });

  it('refuses Reindex with the reason', () => {
    expect(reindexDecision({ availability: { reason: 'not_configured' }, health: 'unavailable' }, 'admin')).toEqual({
      kind: 'denied',
      reason: 'settings.search.diagnostics.notConfigured',
    });
    expect(reindexDecision({ availability: { reason: 'not_published' }, health: 'unavailable' }, 'admin')).toEqual({
      kind: 'denied',
      reason: 'settings.search.diagnostics.notPublished',
    });
    expect(reindexDecision({ availability: { reason: null }, health: 'indexing' }, 'admin')).toEqual({
      kind: 'denied',
      reason: 'settings.search.diagnostics.reindexActive',
    });
    // The provider is down for now, but a run is still queued or going.
    for (const status of ['PENDING', 'RUNNING']) {
      expect(reindexDecision({ availability: { reason: 'provider_unavailable' }, health: 'unavailable', latestRun: { status } }, 'admin')).toEqual({
        kind: 'denied',
        reason: 'settings.search.diagnostics.reindexActive',
      });
    }
    for (const status of ['READY', 'FAILED', 'DISABLED']) {
      expect(reindexDecision({ availability: { reason: 'provider_unavailable' }, health: 'unavailable', latestRun: { status } }, 'admin')).toEqual({
        kind: 'allowed',
      });
    }
  });

  it('locks Reindex without a word while loading or for non-Admins', () => {
    expect(reindexDecision(undefined, 'admin')).toEqual({ kind: 'locked' });
    expect(reindexDecision(ready, 'pending')).toEqual({ kind: 'locked' });
    expect(reindexDecision(ready, 'notAdmin')).toEqual({ kind: 'locked' });
  });

  it('gives every health a label and a tone', () => {
    expect(HEALTH.ready).toEqual({ label: 'settings.search.diagnostics.health.ready', tone: 'success' });
    expect(HEALTH.failed.tone).toBe('danger');
    expect(HEALTH.stale.tone).toBe('warning');
    expect(HEALTH.indexing.tone).toBe('pending');
  });

  it('badges an issue by its code, else by its status', () => {
    expect(issueBadge({ status: 'failed', errorCode: 'EMBED_TIMEOUT' })).toEqual({
      label: 'settings.search.diagnostics.issueCode',
      code: 'EMBED_TIMEOUT',
      tone: 'danger',
    });
    expect(issueBadge({ status: 'failed' })).toEqual({ label: 'settings.search.diagnostics.issueFailed', tone: 'danger' });
    expect(issueBadge({ status: 'stale' })).toEqual({ label: 'settings.search.diagnostics.issueStale', tone: 'warning' });
  });

  it('lists a distribution, or nothing', () => {
    expect(
      distributionText([
        { key: 'en', count: 120 },
        { key: 'ar', count: 80 },
      ]),
    ).toBe('en · 120, ar · 80');
    expect(distributionText([])).toBeNull();
  });

  it('pages samples back once moved forward, and forward while there are more', () => {
    expect(samplePager(1, 'next')).toEqual({ canGoBack: false, canGoForward: true });
    expect(samplePager(2, null)).toEqual({ canGoBack: true, canGoForward: false });
  });
});
