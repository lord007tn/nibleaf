import { describe, expect, it } from 'vitest';
import { aiAccess, aiPageState, checklist, offeredSources, type SiteAi, sourceOptions, switchDecision } from './ai';

type Connection = SiteAi['status']['connections'][number];
const key = (id: Connection['id'], state: Connection['state'] = 'ok'): Connection => ({
  id,
  state,
  failure: null,
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
      preparation: { state: 'ready', pages: 128, expectedPages: 128, at: '2026-11-11T08:05:00.000Z' },
      usage: { answersToday: 37, spent: 37, limit: 200, resetsAt: '2026-11-12T00:00:00.000Z' },
      ...overrides.status,
    },
    viewer: { canManage: true },
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
      ai: siteAi({ status: { ...on, preparation: { state: 'running', pages: 40, expectedPages: 40, at: null } } }),
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
      name: 'provider unreachable',
      ai: siteAi({ status: { ...on, source: 'openai', connections: [key('openai', 'unreachable')] } }),
      state: { kind: 'notWorking', problem: 'keyUnreachable' },
    },
    {
      name: 'model withdrawn',
      ai: siteAi({ status: { ...on, source: 'openrouter', connections: [key('openrouter', 'modelWithdrawn')] } }),
      state: { kind: 'notWorking', problem: 'modelWithdrawn' },
    },
    {
      name: 'some pages could not be prepared: the rest still answer',
      ai: siteAi({ status: { ...on, preparation: { state: 'partial', pages: 125, expectedPages: 128, at: null } } }),
      state: { kind: 'on' },
    },
    {
      name: 'search serves another collection after an embedding change',
      ai: siteAi({ capabilities: { answers: { available: false, reason: 'searchIndexSwitching' } }, status: on }),
      state: { kind: 'unavailable' },
    },
    {
      name: 'Nibleaf AI selected but gone',
      ai: siteAi({ capabilities: noManaged, status: on }),
      state: { kind: 'notWorking', problem: 'managedUnavailable' },
    },
    { name: 'not published', ai: siteAi({ status: { ...on, published: null } }), state: { kind: 'notWorking', problem: 'notPublished' } },
    {
      name: 'never prepared',
      ai: siteAi({ status: { ...on, preparation: { state: 'none', pages: 0, expectedPages: 0, at: null } } }),
      state: { kind: 'notWorking', problem: 'notPrepared' },
    },
    {
      name: 'preparation failed',
      ai: siteAi({ status: { ...on, preparation: { state: 'failed', pages: 0, expectedPages: 0, at: null } } }),
      state: { kind: 'notWorking', problem: 'preparationFailed' },
    },
    {
      name: 'daily limit reached',
      ai: siteAi({ status: { ...on, usage: { answersToday: 200, spent: 200, limit: 200, resetsAt: '2026-11-12T00:00:00.000Z' } } }),
      state: { kind: 'notWorking', problem: 'limitReached' },
    },
    {
      name: 'a limit of zero',
      ai: siteAi({ status: { ...on, usage: { answersToday: 0, spent: 0, limit: 0, resetsAt: '2026-11-12T00:00:00.000Z' } } }),
      state: { kind: 'notWorking', problem: 'limitReached' },
    },
    {
      name: 'an unknown count is not a reached limit',
      ai: siteAi({ status: { ...on, usage: { answersToday: null, spent: null, limit: 200, resetsAt: '2026-11-12T00:00:00.000Z' } } }),
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
      ai: siteAi({ status: { ...on, preparation: { state: 'running', pages: 3, expectedPages: 3, at: null } } }),
      expected: { prepared: 'working' },
    },
    {
      name: 'never prepared',
      ai: siteAi({ status: { preparation: { state: 'none', pages: 0, expectedPages: 0, at: null } } }),
      expected: { prepared: 'problem:prepare' },
    },
    {
      name: 'preparation failed',
      ai: siteAi({ status: { preparation: { state: 'failed', pages: 0, expectedPages: 0, at: null } } }),
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
      name: 'provider unreachable',
      ai: siteAi({ status: { ...on, source: 'openai', connections: [key('openai', 'unreachable')] } }),
      expected: { source: 'problem:checkAgain' },
    },
    {
      name: 'model withdrawn',
      ai: siteAi({ status: { ...on, source: 'openai', connections: [key('openai', 'modelWithdrawn')] } }),
      expected: { source: 'problem:changeModel' },
    },
    {
      name: 'partly prepared',
      ai: siteAi({ status: { ...on, preparation: { state: 'partial', pages: 125, expectedPages: 128, at: null } } }),
      expected: { prepared: 'warning:prepare', source: 'ok' },
    },
    {
      name: 'no key saved for the selected provider',
      ai: siteAi({ status: { ...on, source: 'openrouter' } }),
      expected: { source: 'problem:addKey' },
    },
    { name: 'Nibleaf AI gone', ai: siteAi({ capabilities: noManaged, status: on }), expected: { source: 'problem' } },
    {
      name: 'daily limit reached',
      ai: siteAi({ status: { ...on, usage: { answersToday: 200, spent: 200, limit: 200, resetsAt: '2026-11-12T00:00:00.000Z' } } }),
      expected: { usage: 'problem:seeUsage' },
    },
    {
      name: 'counter unknown',
      ai: siteAi({ status: { usage: { answersToday: null, spent: null, limit: 200, resetsAt: '2026-11-12T00:00:00.000Z' } } }),
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
    // Code only (comments may explain the rule); any identifier or token that
    // names a deployment kind fails: isCloud, NIBLEAF_EDITION, selfHosted, isHosted…
    const tokens = (source: string) =>
      source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/.*$/gm, '$1')
        .match(/[A-Za-z_$][\w$]*/g) ?? [];
    const edition = /cloud|edition|ishosted|selfhost/i;
    for (const file of ['./ai.ts', '../api/query-options.ts']) {
      expect(tokens(readFileSync(new URL(file, import.meta.url), 'utf8')).filter((token) => edition.test(token))).toEqual([]);
    }
  });
});

describe('aiAccess', () => {
  it.each([
    { name: 'not loaded yet', ai: undefined, access: 'pending' },
    { name: 'a site Admin', ai: siteAi(), access: 'admin' },
    { name: 'an Editor or Viewer (read-only)', ai: { ...siteAi(), viewer: { canManage: false } }, access: 'notAdmin' },
  ] as const)('$name → $access', ({ ai, access }) => {
    expect(aiAccess(ai)).toBe(access);
  });

  it('locks every control for someone who may only read', () => {
    const ai = { ...siteAi(), viewer: { canManage: false } };
    expect(switchDecision(ai, aiAccess(ai)).decision).toEqual({ kind: 'locked' });
    expect(sourceOptions(ai, aiAccess(ai)).every(({ decision }) => decision.kind === 'locked')).toBe(true);
  });
});

describe('CodeRabbit review on #513', () => {
  const quota = (answersToday: number | null, spent: number | null, limit = 200) => ({
    answersToday,
    spent,
    limit,
    resetsAt: '2026-11-12T00:00:00.000Z',
  });

  it('reports the limit reached when failed generations used the quota, even with few answers completed', () => {
    const ai = siteAi({ status: { ...on, usage: quota(3, 200) } });
    expect(aiPageState(ai)).toEqual({ kind: 'notWorking', problem: 'limitReached' });
    expect(checklist(ai).find(({ id }) => id === 'usage')).toEqual({ id: 'usage', tone: 'problem', fix: 'seeUsage' });
  });

  it('does not report the limit from completed answers alone', () => {
    const ai = siteAi({ status: { ...on, usage: quota(200, 120) } });
    expect(aiPageState(ai)).toEqual({ kind: 'on' });
  });

  it('treats an unreadable spend count as not reached', () => {
    expect(aiPageState(siteAi({ status: { ...on, usage: quota(null, null) } }))).toEqual({ kind: 'on' });
  });

  it.each(['needsRecheck', 'ok', 'rejected'] as const)(
    'sends the owner to another source when the selected provider is no longer offered (its key is %s)',
    (state) => {
      const ai = siteAi({
        capabilities: {
          providers: [
            { id: 'openai', available: false, reason: 'embeddingModelRequiresOpenRouter' },
            { id: 'openrouter', available: true, reason: null },
          ],
        },
        status: { ...on, source: 'openai', connections: [key('openai', state)] },
      });
      expect(aiPageState(ai)).toEqual({ kind: 'notWorking', problem: 'sourceNotOffered' });
      expect(checklist(ai).find(({ id }) => id === 'source')).toEqual({ id: 'source', tone: 'problem', fix: 'chooseSource' });
      // It is no longer listed, and the others still are.
      expect(sourceOptions(ai, 'admin').map(({ id }) => id)).toEqual(['managed', 'openrouter']);
    },
  );

  it('still offers "Check key" for a re-checkable key whose provider is offered', () => {
    const ai = siteAi({ status: { ...on, source: 'openai', connections: [key('openai', 'needsRecheck')] } });
    expect(checklist(ai).find(({ id }) => id === 'source')).toEqual({ id: 'source', tone: 'problem', fix: 'checkKey' });
  });
});
