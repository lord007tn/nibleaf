import { MCP_PRESET_SCOPES, MCP_TOOL_SCOPES } from '@nibleaf/shared/mcp';
import { describe, expect, it } from 'vitest';
import { ASSISTANT_CLIENTS, clientChoices, connectSteps, defaultClient, keyClientFor } from './clients';
import { canRestart, keepWatching, restartWatch, startWatch, WATCH_MS, watchState, withBaseline } from './connect-watch';
import { connectionRows, keyStatus } from './connections';
import { assistantPageState, defaultPreset, presetChoices } from './page-state';
import { EXAMPLE_PROMPTS, examplePrompts, minimumPreset } from './prompts';

const meta = { mcpEnabled: true, mcpEndpoint: 'https://docs.example/api/mcp', mcpOAuthEnabled: true };

describe('assistantPageState', () => {
  it.each([
    [{ meta: undefined, role: 'admin', loadFailed: false }, 'loading'],
    [{ meta: undefined, role: 'admin', loadFailed: true }, 'loadFailed'],
    [{ meta: { ...meta, mcpEnabled: false }, role: 'admin', loadFailed: false }, 'off'],
    [{ meta: { ...meta, mcpEnabled: false }, role: 'viewer', loadFailed: false }, 'off'],
    [{ meta, role: 'viewer', loadFailed: false }, 'noAccess'],
    [{ meta, role: 'member', loadFailed: false }, 'ready'],
    // A refresh that fails keeps the page on what was already loaded.
    [{ meta, role: 'member', loadFailed: true }, 'ready'],
  ] as const)('%o → %s', (input, kind) => {
    expect(assistantPageState(input).kind).toBe(kind);
  });

  it('reads sign-in from the server, never from the edition, and lets admins manage everyone', () => {
    expect(assistantPageState({ meta, role: 'admin', loadFailed: false })).toMatchObject({ kind: 'ready', signIn: true, manageAll: true });
    expect(assistantPageState({ meta: { ...meta, mcpOAuthEnabled: undefined }, role: 'member', loadFailed: false })).toMatchObject({
      signIn: false,
      manageAll: false,
    });
  });
});

describe('presetChoices', () => {
  it('offers Full admin to admins only', () => {
    expect(presetChoices('member')).toEqual([
      { preset: 'read_only', reason: null },
      { preset: 'support_writer', reason: null },
      { preset: 'full_admin', reason: 'adminOnly' },
    ]);
    expect(presetChoices('owner').every((choice) => choice.reason === null)).toBe(true);
  });

  it('leaves room for a website limit that applies to non-admins (D3, not enabled yet)', () => {
    expect(presetChoices('member', { maxPreset: 'read_only' }).map((choice) => choice.reason)).toEqual([null, 'siteLimit', 'adminOnly']);
    expect(presetChoices('admin', { maxPreset: 'read_only' }).every((choice) => choice.reason === null)).toBe(true);
    expect(defaultPreset(presetChoices('member', { maxPreset: 'read_only' }))).toBe('read_only');
    expect(defaultPreset(presetChoices('member'))).toBe('support_writer');
    expect(defaultPreset(presetChoices('viewer'))).toBeNull();
  });
});

describe('clients', () => {
  it('disables the sign-in-only apps with a reason when the server cannot sign apps in', () => {
    expect(clientChoices(true).every((choice) => choice.disabledReason === null)).toBe(true);
    expect(
      clientChoices(false)
        .filter((choice) => choice.disabledReason)
        .map((choice) => choice.client),
    ).toEqual(['chatgpt', 'claude']);
    expect(defaultClient(true)).toBe('chatgpt');
    expect(defaultClient(false)).toBe('claudeCode');
  });

  it('gives every app numbered sign-in steps with the address on the step where it is pasted', () => {
    for (const client of ASSISTANT_CLIENTS) {
      const steps = connectSteps(client, { endpoint: meta.mcpEndpoint, signIn: true });
      expect(steps.length).toBeGreaterThanOrEqual(3);
      expect(steps.at(-1)?.text).toBe('signIn');
      const copied = steps.map((step) => step.copy?.value ?? step.install?.href ?? '').join('\n');
      expect(
        copied.includes(meta.mcpEndpoint) ||
          decodeURIComponent(copied).includes(meta.mcpEndpoint) ||
          copied.includes(btoa(JSON.stringify({ url: meta.mcpEndpoint }))),
      ).toBe(true);
    }
    expect(connectSteps('claude', { endpoint: meta.mcpEndpoint, signIn: true })[0]?.menu).toEqual(['Settings', 'Connectors', 'Add custom connector']);
  });

  it('keeps menu paths out of sentences, as their own tokens', () => {
    for (const client of ASSISTANT_CLIENTS)
      for (const step of connectSteps(client, { endpoint: meta.mcpEndpoint, signIn: true }))
        for (const item of step.menu ?? []) expect(item).not.toMatch(/[→>]/);
  });

  it('routes key-capable apps to a personal key when sign-in is unavailable', () => {
    expect(connectSteps('chatgpt', { endpoint: meta.mcpEndpoint, signIn: false })).toEqual([]);
    expect(connectSteps('cursor', { endpoint: meta.mcpEndpoint, signIn: false })).toEqual([{ text: 'useKey', createKey: true }]);
    expect(keyClientFor('cursor')).toBe('cursor');
    expect(keyClientFor('chatgpt')).toBe('claudeCode');
  });
});

describe('example prompts', () => {
  it('name only tools the server registers', () => {
    for (const prompt of EXAMPLE_PROMPTS) for (const tool of prompt.tools) expect(MCP_TOOL_SCOPES).toHaveProperty(tool);
  });

  it('state the smallest permission that covers every tool they lead to', () => {
    expect(minimumPreset(['get_page'])).toBe('read_only');
    expect(minimumPreset(['get_failed_searches'])).toBe('support_writer');
    expect(minimumPreset(['get_usage_summary'])).toBe('full_admin');
    for (const { id, preset } of examplePrompts()) {
      const tools = EXAMPLE_PROMPTS.find((prompt) => prompt.id === id)?.tools ?? [];
      expect(tools.every((tool) => MCP_PRESET_SCOPES[preset].includes(MCP_TOOL_SCOPES[tool]))).toBe(true);
    }
    expect(examplePrompts().map(({ id, preset }) => `${id}:${preset}`)).toEqual([
      'healthReport:read_only',
      'aiGaps:read_only',
      'failedSearches:support_writer',
      'draftPage:support_writer',
    ]);
  });
});

const now = Date.parse('2026-11-12T12:00:00Z');
const person = (id: string, name: string) => ({ id, name, email: `${id}@example.com` });
const key = (id: string, overrides: Partial<Parameters<typeof keyStatus>[0]> = {}) => ({
  id,
  state: 'active' as const,
  expiresAt: '2027-01-01T00:00:00Z',
  lastUsedAt: null,
  createdAt: '2026-11-01T00:00:00Z',
  createdBy: person('u1', 'Ada'),
  ...overrides,
});
const app = (id: string, overrides: Partial<{ lastUsedAt: string | null; createdAt: string; connectedBy: ReturnType<typeof person> }> = {}) => ({
  id,
  lastUsedAt: null,
  createdAt: '2026-11-02T00:00:00Z',
  connectedBy: person('u2', 'Sara'),
  ...overrides,
});

describe('connections', () => {
  it.each([
    [key('k'), 'active', 50],
    [key('k', { expiresAt: '2026-11-15T00:00:00Z' }), 'expiringSoon', 3],
    [key('k', { expiresAt: '2026-11-12T11:00:00Z' }), 'expired', null],
    [key('k', { state: 'expired' }), 'expired', null],
    [key('k', { state: 'revoked' }), 'revoked', null],
    [key('k', { state: 'rotation_required', expiresAt: null }), 'rotationRequired', null],
  ] as const)('key %# is %s', (input, status, daysLeft) => {
    expect(keyStatus(input, now)).toEqual({ status, daysLeft });
  });

  it('lists apps and keys together, live first by last use, inactive apart, with a person filter', () => {
    const keys = [
      key('old', { lastUsedAt: '2026-11-03T00:00:00Z' }),
      key('dead', { state: 'revoked' }),
      key('soon', { expiresAt: '2026-11-14T00:00:00Z', lastUsedAt: '2026-11-11T00:00:00Z', createdBy: person('u2', 'Sara') }),
    ];
    const apps = [app('chatgpt', { lastUsedAt: '2026-11-12T11:00:00Z' })];
    const all = connectionRows(keys, apps, { now });
    expect(all.live.map((row) => row.id)).toEqual(['chatgpt', 'soon', 'old']);
    expect(all.inactive.map((row) => row.id)).toEqual(['dead']);
    expect(all.people).toEqual([
      { id: 'u1', name: 'Ada' },
      { id: 'u2', name: 'Sara' },
    ]);
    expect(connectionRows(keys, apps, { now, personId: 'u2' }).live.map((row) => row.id)).toEqual(['chatgpt', 'soon']);
  });
});

describe('connect watch', () => {
  const watched = (
    id: string,
    overrides: Partial<{ name: string; ownedByViewer: boolean; createdAt: string; lastActivity: { outcome: string } | null }> = {},
  ) => ({
    id,
    name: 'ChatGPT',
    createdAt: '2026-11-12T12:01:00Z',
    ownedByViewer: true,
    lastActivity: null,
    ...overrides,
  });

  it('counts only new grants by this person for the chosen app, and says working only after a call that succeeded', () => {
    const watch = startWatch('chatgpt', [{ id: 'existing' }], now);
    expect(watch.until).toBe(now + WATCH_MS);
    expect(watchState(watch, [watched('existing', { lastActivity: { outcome: 'succeeded' } })], now).kind).toBe('waiting');
    // A teammate's new connection (another tab, another person) never reads as this one.
    expect(watchState(watch, [watched('teammate', { ownedByViewer: false })], now).kind).toBe('waiting');
    expect(watchState(watch, [watched('new')], now)).toMatchObject({ kind: 'authorized', app: { id: 'new' } });
    expect(watchState(watch, [watched('new', { lastActivity: { outcome: 'failed' } })], now).kind).toBe('authorized');
    expect(watchState(watch, [watched('new', { lastActivity: { outcome: 'succeeded' } })], now).kind).toBe('working');
    expect(watchState(watch, [watched('new', { lastActivity: { outcome: 'replayed' } })], now).kind).toBe('working');
  });

  it('never calls a write that has only started "working"', () => {
    const watch = startWatch('chatgpt', [], now);
    expect(watchState(watch, [watched('new', { lastActivity: { outcome: 'started' } })], now).kind).toBe('authorized');
  });

  it('takes no baseline while the list is loading, so old grants never look new', () => {
    const watch = startWatch('chatgpt', undefined, now);
    expect(watch.baseline).toBeNull();
    const old = watched('old', { lastActivity: { outcome: 'succeeded' } });
    expect(watchState(watch, [old], now).kind).toBe('waiting');
    const filled = withBaseline(watch, [old]);
    expect(filled.baseline).toEqual(['old']);
    expect(withBaseline(filled, [old, watched('new')])).toBe(filled);
    expect(watchState(filled, [old], now).kind).toBe('waiting');
    expect(watchState(filled, [old, watched('new')], now).kind).toBe('authorized');
  });

  it('flags a new grant named like another app instead of claiming it is the chosen one', () => {
    const watch = startWatch('chatgpt', [], now);
    expect(watchState(watch, [watched('other', { name: 'Totally Legit Assistant', lastActivity: { outcome: 'succeeded' } })], now)).toMatchObject({
      kind: 'unexpected',
      app: { id: 'other' },
    });
    const claude = startWatch('claude', [], now);
    expect(watchState(claude, [watched('cc', { name: 'Claude Code' })], now).kind).toBe('unexpected');
    expect(watchState(claude, [watched('c', { name: 'Claude' })], now).kind).toBe('authorized');
    expect(watchState(startWatch('claudeCode', [], now), [watched('cc', { name: 'claude-code' })], now).kind).toBe('authorized');
  });

  it('ends an unfinished watch at the deadline with a restart, and prefers a working grant', () => {
    const watch = startWatch('claude', [], now);
    const later = now + WATCH_MS;
    const apps = [watched('a', { name: 'Claude', lastActivity: { outcome: 'succeeded' } }), watched('b', { name: 'Claude', createdAt: '2026-11-12T12:05:00Z' })];
    expect(watchState(watch, apps, now)).toMatchObject({ kind: 'working', app: { id: 'a' } });
    const timedOut = watchState(watch, [], later);
    expect(timedOut.kind).toBe('timedOut');
    const stalled = watchState(watch, [watched('b', { name: 'Claude' })], later);
    expect(stalled.kind).toBe('stalled');
    expect(canRestart(timedOut) && canRestart(stalled)).toBe(true);
    expect(keepWatching(stalled, watch, later)).toBe(false);
    const again = restartWatch(watch, later);
    expect(again.baseline).toEqual(watch.baseline);
    expect(watchState(again, [watched('b', { name: 'Claude' })], later).kind).toBe('authorized');
  });
});
