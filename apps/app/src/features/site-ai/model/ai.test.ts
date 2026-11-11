import { describe, expect, it } from 'vitest';
import { aiPageState, checklist, offeredSources, type SiteAi, sourceOptions, switchDecision } from './ai';

type Connection = SiteAi['status']['connections'][number];
const key = (id: Connection['id'], state: Connection['state'] = 'ok'): Connection => ({
  id,
  state,
  keyHint: '4f2a',
  addedAt: '2026-11-10T09:00:00.000Z',
  model: { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
});

/** A Cloud-like server (Nibleaf AI and own keys), a published and prepared site, AI off. */
function siteAi(overrides: { capabilities?: Partial<SiteAi['capabilities']>; status?: Partial<SiteAi['status']> } = {}): SiteAi {
  return {
    capabilities: {
      managed: { available: true, reason: null, model: { id: 'openai/gpt-6-luna', label: 'GPT-6 Luna' }, dailyAnswerLimit: 200 },
      ownKey: { available: true, reason: null },
      providers: [
        { id: 'openai', available: true, reason: null },
        { id: 'openrouter', available: true, reason: null },
      ],
      answers: { available: true, reason: null },
      ...overrides.capabilities,
    },
    status: {
      answersOn: false,
      source: 'managed',
      sourceReady: true,
      connections: [],
      published: { version: 12, at: '2026-11-11T08:00:00.000Z' },
      preparation: { state: 'ready', pages: 128, at: '2026-11-11T08:05:00.000Z' },
      usage: { answersToday: 37, limit: 200, resetsAt: '2026-11-12T00:00:00.000Z' },
      ...overrides.status,
    },
  };
}
const noManaged = { managed: { available: false, reason: 'noServerKey' as const, model: null, dailyAnswerLimit: 200 } };
const noOwnKeys = {
  ownKey: { available: false, reason: 'credentialStorageMissing' as const },
  providers: [
    { id: 'openai' as const, available: false, reason: 'credentialStorageMissing' as const },
    { id: 'openrouter' as const, available: false, reason: 'credentialStorageMissing' as const },
  ],
};
const on = { answersOn: true };

describe('offeredSources', () => {
  it.each([
    { name: 'Nibleaf AI and own keys', capabilities: {}, sources: ['managed', 'openai', 'openrouter'] },
    { name: 'own keys only (self-host without a server key)', capabilities: noManaged, sources: ['openai', 'openrouter'] },
    { name: 'Nibleaf AI only (no credential storage)', capabilities: noOwnKeys, sources: ['managed'] },
    {
      name: 'OpenAI direct not possible with this embedding model',
      capabilities: {
        providers: [
          { id: 'openai' as const, available: false, reason: 'embeddingModelRequiresOpenRouter' as const },
          { id: 'openrouter' as const, available: true, reason: null },
        ],
      },
      sources: ['managed', 'openrouter'],
    },
    { name: 'nothing', capabilities: { ...noManaged, ...noOwnKeys }, sources: [] },
  ])('$name', ({ capabilities, sources }) => {
    expect(offeredSources(siteAi({ capabilities }))).toEqual(sources);
  });
});

describe('aiPageState', () => {
  it.each([
    {
      name: 'search not set up on the server',
      ai: siteAi({ capabilities: { answers: { available: false, reason: 'searchNotConfigured' } } }),
      state: { kind: 'unavailable' },
    },
    { name: 'no source the server can offer', ai: siteAi({ capabilities: { ...noManaged, ...noOwnKeys } }), state: { kind: 'unavailable' } },
    { name: 'answers off', ai: siteAi(), state: { kind: 'off' } },
    { name: 'on with Nibleaf AI', ai: siteAi({ status: on }), state: { kind: 'on' } },
    { name: 'on with a working own key', ai: siteAi({ status: { ...on, source: 'openai', connections: [key('openai')] } }), state: { kind: 'on' } },
    {
      name: 'on while docs are being prepared',
      ai: siteAi({ status: { ...on, preparation: { state: 'running', pages: 40, at: null } } }),
      state: { kind: 'preparing' },
    },
    {
      name: 'own key selected but none saved',
      ai: siteAi({ status: { ...on, source: 'openai' } }),
      state: { kind: 'notWorking', problem: 'keyMissing' },
    },
    {
      name: 'key refused',
      ai: siteAi({ status: { ...on, source: 'openai', connections: [key('openai', 'rejected')] } }),
      state: { kind: 'notWorking', problem: 'keyRejected' },
    },
    {
      name: 'key needs a re-check',
      ai: siteAi({ status: { ...on, source: 'openrouter', connections: [key('openrouter', 'needsRecheck')] } }),
      state: { kind: 'notWorking', problem: 'keyNeedsRecheck' },
    },
    {
      name: 'key unreadable',
      ai: siteAi({ status: { ...on, source: 'openai', connections: [key('openai', 'unreadable')] } }),
      state: { kind: 'notWorking', problem: 'keyUnreadable' },
    },
    {
      name: 'Nibleaf AI selected but gone',
      ai: siteAi({ capabilities: noManaged, status: on }),
      state: { kind: 'notWorking', problem: 'managedUnavailable' },
    },
    { name: 'not published', ai: siteAi({ status: { ...on, published: null } }), state: { kind: 'notWorking', problem: 'notPublished' } },
    {
      name: 'never prepared',
      ai: siteAi({ status: { ...on, preparation: { state: 'none', pages: 0, at: null } } }),
      state: { kind: 'notWorking', problem: 'notPrepared' },
    },
    {
      name: 'preparation failed',
      ai: siteAi({ status: { ...on, preparation: { state: 'failed', pages: 0, at: null } } }),
      state: { kind: 'notWorking', problem: 'preparationFailed' },
    },
    {
      name: 'daily limit reached',
      ai: siteAi({ status: { ...on, usage: { answersToday: 200, limit: 200, resetsAt: '2026-11-12T00:00:00.000Z' } } }),
      state: { kind: 'notWorking', problem: 'limitReached' },
    },
    {
      name: 'a limit of zero',
      ai: siteAi({ status: { ...on, usage: { answersToday: 0, limit: 0, resetsAt: '2026-11-12T00:00:00.000Z' } } }),
      state: { kind: 'notWorking', problem: 'limitReached' },
    },
    {
      name: 'an unknown count is not a reached limit',
      ai: siteAi({ status: { ...on, usage: { answersToday: null, limit: 200, resetsAt: '2026-11-12T00:00:00.000Z' } } }),
      state: { kind: 'on' },
    },
    {
      name: 'the source problem wins over publishing',
      ai: siteAi({ status: { ...on, source: 'openai', connections: [key('openai', 'rejected')], published: null } }),
      state: { kind: 'notWorking', problem: 'keyRejected' },
    },
  ] as const)('$name', ({ ai, state }) => {
    expect(aiPageState(ai)).toEqual(state);
  });
});

describe('sourceOptions', () => {
  it('offers Nibleaf AI and both keys, with a missing or broken key not choosable', () => {
    const ai = siteAi({ status: { connections: [key('openrouter', 'rejected')] } });
    expect(sourceOptions(ai, 'admin').map(({ id, selected, decision }) => ({ id, selected, decision }))).toEqual([
      { id: 'managed', selected: true, decision: { kind: 'allowed' } },
      { id: 'openai', selected: false, decision: { kind: 'denied', reason: 'addKeyFirst' } },
      { id: 'openrouter', selected: false, decision: { kind: 'denied', reason: 'keyNotWorking' } },
    ]);
  });

  it('carries the saved key, never more than its hint and model', () => {
    const [, openai] = sourceOptions(siteAi({ status: { connections: [key('openai')] } }), 'admin');
    expect(openai).toMatchObject({ id: 'openai', decision: { kind: 'allowed' }, connection: { keyHint: '4f2a' } });
  });

  it('never draws a source the server cannot offer', () => {
    expect(sourceOptions(siteAi({ capabilities: noManaged }), 'admin').map(({ id }) => id)).toEqual(['openai', 'openrouter']);
  });

  it.each(['notAdmin', 'pending'] as const)('locks every choice while access is %s', (access) => {
    expect(sourceOptions(siteAi(), access).every(({ decision }) => decision.kind === 'locked')).toBe(true);
  });
});

describe('switchDecision', () => {
  it.each([
    { name: 'turning on with Nibleaf AI', ai: siteAi(), result: { decision: { kind: 'allowed' }, turnsOnWith: 'managed' } },
    {
      name: 'turning on keeps a working selected key',
      ai: siteAi({ status: { source: 'openai', connections: [key('openai')] } }),
      result: { decision: { kind: 'allowed' }, turnsOnWith: 'openai' },
    },
    {
      name: 'self-host with a working key and no Nibleaf AI',
      ai: siteAi({ capabilities: noManaged, status: { connections: [key('openrouter')] } }),
      result: { decision: { kind: 'allowed' }, turnsOnWith: 'openrouter' },
    },
    {
      name: 'self-host with no key yet',
      ai: siteAi({ capabilities: noManaged }),
      result: { decision: { kind: 'denied', reason: 'addKeyFirst' }, turnsOnWith: null },
    },
    {
      name: 'nothing published',
      ai: siteAi({ status: { published: null } }),
      result: { decision: { kind: 'denied', reason: 'publishFirst' }, turnsOnWith: null },
    },
    {
      name: 'the server cannot answer',
      ai: siteAi({ capabilities: { answers: { available: false, reason: 'searchNotConfigured' } } }),
      result: { decision: { kind: 'denied', reason: 'serverUnavailable' }, turnsOnWith: null },
    },
    {
      name: 'turning off is always possible, even when answers are not working',
      ai: siteAi({ status: { ...on, source: 'openai', connections: [key('openai', 'rejected')] } }),
      result: { decision: { kind: 'allowed' }, turnsOnWith: null },
    },
  ] as const)('$name', ({ ai, result }) => {
    expect(switchDecision(ai, 'admin')).toEqual(result);
  });

  it.each(['notAdmin', 'pending'] as const)('is locked while access is %s', (access) => {
    expect(switchDecision(siteAi(), access)).toEqual({ decision: { kind: 'locked' }, turnsOnWith: null });
  });
});

describe('checklist', () => {
  const rows = (ai: SiteAi) => Object.fromEntries(checklist(ai).map(({ id, tone, fix }) => [id, fix ? `${tone}:${fix}` : tone]));

  it.each([
    { name: 'all good', ai: siteAi({ status: on }), expected: { published: 'ok', prepared: 'ok', source: 'ok', usage: 'ok' } },
    { name: 'answers off', ai: siteAi(), expected: { published: 'ok', prepared: 'ok', source: 'idle', usage: 'ok' } },
    { name: 'AI turned off for the site', ai: siteAi({ status: { source: null } }), expected: { source: 'idle' } },
    {
      name: 'not published',
      ai: siteAi({ status: { ...on, published: null } }),
      expected: { published: 'problem:publish', prepared: 'idle' },
    },
    {
      name: 'preparing',
      ai: siteAi({ status: { ...on, preparation: { state: 'running', pages: 3, at: null } } }),
      expected: { prepared: 'working' },
    },
    {
      name: 'never prepared',
      ai: siteAi({ status: { preparation: { state: 'none', pages: 0, at: null } } }),
      expected: { prepared: 'problem:prepare' },
    },
    {
      name: 'preparation failed',
      ai: siteAi({ status: { preparation: { state: 'failed', pages: 0, at: null } } }),
      expected: { prepared: 'problem:prepare' },
    },
    {
      name: 'key refused',
      ai: siteAi({ status: { ...on, source: 'openai', connections: [key('openai', 'rejected')] } }),
      expected: { source: 'problem:replaceKey' },
    },
    {
      name: 'key unreadable',
      ai: siteAi({ status: { ...on, source: 'openai', connections: [key('openai', 'unreadable')] } }),
      expected: { source: 'problem:replaceKey' },
    },
    {
      name: 'key needs a re-check',
      ai: siteAi({ status: { ...on, source: 'openai', connections: [key('openai', 'needsRecheck')] } }),
      expected: { source: 'problem:checkKey' },
    },
    {
      name: 'no key saved for the selected provider',
      ai: siteAi({ status: { ...on, source: 'openrouter' } }),
      expected: { source: 'problem:addKey' },
    },
    { name: 'Nibleaf AI gone', ai: siteAi({ capabilities: noManaged, status: on }), expected: { source: 'problem' } },
    {
      name: 'daily limit reached',
      ai: siteAi({ status: { ...on, usage: { answersToday: 200, limit: 200, resetsAt: '2026-11-12T00:00:00.000Z' } } }),
      expected: { usage: 'problem:seeUsage' },
    },
    {
      name: 'counter unknown',
      ai: siteAi({ status: { usage: { answersToday: null, limit: 200, resetsAt: '2026-11-12T00:00:00.000Z' } } }),
      expected: { usage: 'idle' },
    },
  ] as const)('$name', ({ ai, expected }) => {
    expect(rows(ai)).toMatchObject(expected);
  });

  it('always lists the four steps in reader order', () => {
    expect(checklist(siteAi()).map(({ id }) => id)).toEqual(['published', 'prepared', 'source', 'usage']);
  });
});

describe('no edition branch', () => {
  it('decides from capabilities only, never from a Cloud or edition flag', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./ai.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\b(isCloud|IS_CLOUD|NIBLEAF_CLOUD|NIBLEAF_EDITION|edition|isSelfHosted|SELF_HOSTED)\b/);
  });
});
