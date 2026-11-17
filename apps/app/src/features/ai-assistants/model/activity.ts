import type { MessageKey } from '@nibleaf/i18n';

/** The newest MCP audit event of a key or app, as the API reports it. */
export interface McpActivityLike {
  operation: string;
  outcome: string;
  errorCode?: string | null;
  at: string;
}

// ─── Latest activity in plain words ─────────────────────────────────────────

const SUCCEEDED: Record<string, MessageKey> = {
  publish_changes: 'settings.mcpActivity.published',
  update_page: 'settings.mcpActivity.updatedPage',
  move_page: 'settings.mcpActivity.updatedPage',
  set_page_visibility: 'settings.mcpActivity.updatedPage',
  create_page_draft: 'settings.mcpActivity.createdDraft',
  translate_page: 'settings.mcpActivity.translatedPage',
  preview_publish: 'settings.mcpActivity.previewedPublish',
  search_pages: 'settings.mcpActivity.searchedPages',
  list_pages: 'settings.mcpActivity.readPages',
  get_page: 'settings.mcpActivity.readPages',
  pages: 'settings.mcpActivity.readPages',
  page: 'settings.mcpActivity.readPages',
  get_analytics_overview: 'settings.mcpActivity.readAnalytics',
  get_top_pages: 'settings.mcpActivity.readAnalytics',
  get_top_searches: 'settings.mcpActivity.readAnalytics',
  get_failed_searches: 'settings.mcpActivity.readAnalytics',
  get_page_feedback: 'settings.mcpActivity.readAnalytics',
  get_referrers: 'settings.mcpActivity.readAnalytics',
  get_capabilities: 'settings.mcpActivity.checkedConnection',
  capabilities: 'settings.mcpActivity.checkedConnection',
};

// The scope each write tool needs, which names what a blocked attempt tried to do.
const PUBLISH_TOOLS = new Set(['preview_publish', 'publish_changes']);
const PAGE_WRITE_TOOLS = new Set(['create_page_draft', 'update_page', 'move_page', 'translate_page', 'set_page_visibility']);

const BLOCKED: Record<'key' | 'app', Record<'publish' | 'pages' | 'other', MessageKey>> = {
  key: {
    publish: 'settings.mcpActivity.keyCantPublish',
    pages: 'settings.mcpActivity.keyCantEditPages',
    other: 'settings.mcpActivity.keyNotAllowed',
  },
  app: {
    publish: 'settings.mcpActivity.appCantPublish',
    pages: 'settings.mcpActivity.appCantEditPages',
    other: 'settings.mcpActivity.appNotAllowed',
  },
};

const REFUSED: Record<string, MessageKey> = {
  'mcp:revision_conflict': 'settings.mcpActivity.revisionConflict',
  'mcp:publish_in_progress': 'settings.mcpActivity.publishInProgress',
  'mcp:preview_stale': 'settings.mcpActivity.previewOutdated',
  'mcp:preview_expired': 'settings.mcpActivity.previewOutdated',
  'http:rate_limited': 'settings.mcpActivity.rateLimited',
  'auth:insufficient_role': 'settings.mcpActivity.roleBlocked',
};

export interface ActivitySummary {
  key: MessageKey;
  tool?: string;
  /** `attention` for blocked, refused or unfinished attempts: amber, never red. */
  tone: 'neutral' | 'attention';
}

/** One plain sentence for the newest audit event of a key (`subject: 'key'`)
 *  or a connected app. The raw tool name and code stay in Technical details. */
export function describeMcpActivity(activity: McpActivityLike, subject: 'key' | 'app'): ActivitySummary {
  const { operation, outcome, errorCode } = activity;
  if (outcome === 'replayed') return { key: 'settings.mcpActivity.replayed', tone: 'neutral' };
  if (outcome !== 'failed') {
    const key = SUCCEEDED[operation];
    return key ? { key, tone: 'neutral' } : { key: 'settings.mcpActivity.used', tool: operation.replace(/[_-]+/g, ' ').trim(), tone: 'neutral' };
  }
  if (errorCode === 'mcp:scope_required' || errorCode === 'auth:insufficient_scope') {
    const verb = PUBLISH_TOOLS.has(operation) ? 'publish' : PAGE_WRITE_TOOLS.has(operation) ? 'pages' : 'other';
    return { key: BLOCKED[subject][verb], tone: 'attention' };
  }
  return { key: (errorCode && REFUSED[errorCode]) || 'settings.mcpActivity.didntFinish', tone: 'attention' };
}
