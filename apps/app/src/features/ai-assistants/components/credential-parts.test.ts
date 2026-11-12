import { describe, expect, it } from 'vitest';
import { describeMcpActivity } from '../model/activity';
import { relativeMinutes } from './credential-parts';

const at = '2026-11-06T10:00:00.000Z';
const activity = (operation: string, outcome: string, errorCode: string | null = null) => ({ operation, outcome, errorCode, at });

describe('describeMcpActivity', () => {
  it.each([
    ['publish_changes', 'settings.mcpActivity.published'],
    ['update_page', 'settings.mcpActivity.updatedPage'],
    ['create_page_draft', 'settings.mcpActivity.createdDraft'],
    ['translate_page', 'settings.mcpActivity.translatedPage'],
    ['preview_publish', 'settings.mcpActivity.previewedPublish'],
    ['search_pages', 'settings.mcpActivity.searchedPages'],
    ['get_top_searches', 'settings.mcpActivity.readAnalytics'],
    ['get_capabilities', 'settings.mcpActivity.checkedConnection'],
  ])('describes a successful %s', (operation, key) => {
    expect(describeMcpActivity(activity(operation, 'succeeded'), 'key')).toEqual({ key, tone: 'neutral' });
  });

  it('names other tools in readable words', () => {
    expect(describeMcpActivity(activity('list_versions', 'succeeded'), 'key')).toEqual({
      key: 'settings.mcpActivity.used',
      tool: 'list versions',
      tone: 'neutral',
    });
  });

  it('describes a replayed request', () => {
    expect(describeMcpActivity(activity('publish_changes', 'replayed'), 'key').key).toBe('settings.mcpActivity.replayed');
  });

  it.each([
    ['publish_changes', 'key', 'settings.mcpActivity.keyCantPublish'],
    ['update_page', 'key', 'settings.mcpActivity.keyCantEditPages'],
    ['get_page', 'key', 'settings.mcpActivity.keyNotAllowed'],
    ['preview_publish', 'app', 'settings.mcpActivity.appCantPublish'],
    ['translate_page', 'app', 'settings.mcpActivity.appCantEditPages'],
  ] as const)('names what a %s blocked by scope tried to do (%s)', (operation, subject, key) => {
    expect(describeMcpActivity(activity(operation, 'failed', 'mcp:scope_required'), subject)).toEqual({ key, tone: 'attention' });
  });

  it.each([
    ['mcp:revision_conflict', 'settings.mcpActivity.revisionConflict'],
    ['mcp:publish_in_progress', 'settings.mcpActivity.publishInProgress'],
    ['mcp:preview_stale', 'settings.mcpActivity.previewOutdated'],
    ['mcp:preview_expired', 'settings.mcpActivity.previewOutdated'],
    ['http:rate_limited', 'settings.mcpActivity.rateLimited'],
    ['auth:insufficient_role', 'settings.mcpActivity.roleBlocked'],
    ['http:internal', 'settings.mcpActivity.didntFinish'],
    [null, 'settings.mcpActivity.didntFinish'],
  ])('describes a failure with %s', (errorCode, key) => {
    expect(describeMcpActivity(activity('publish_changes', 'failed', errorCode), 'key')).toEqual({ key, tone: 'attention' });
  });
});

describe('relative last-used time', () => {
  it('uses the largest unit that fits', () => {
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    expect(relativeMinutes(ago(0), 'en')).toBe('this minute');
    expect(relativeMinutes(ago(5), 'en')).toBe('5 minutes ago');
    expect(relativeMinutes(ago(222), 'en')).toBe('3 hours ago');
    expect(relativeMinutes(ago(60 * 24 * 2 + 5), 'en')).toBe('2 days ago');
  });
});
