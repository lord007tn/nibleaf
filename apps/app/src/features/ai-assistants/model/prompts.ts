import { MCP_KEY_PRESETS, MCP_PRESET_SCOPES, MCP_TOOL_SCOPES, type McpKeyPreset, type McpToolName } from '@nibleaf/shared/mcp';

/**
 * Things to ask an assistant once it's connected. Each names the tools it
 * leads to, so a test can prove they exist and the page can say which
 * permission it needs. The wording lives in the message catalogs
 * (`settings.aiAssistants.prompt.<id>`); the full list of ten is in the guide.
 */
export const EXAMPLE_PROMPTS = [
  { id: 'failedSearches', tools: ['get_failed_searches', 'search_pages'] },
  { id: 'healthReport', tools: ['get_analytics_overview', 'get_top_pages', 'get_page_feedback', 'get_search_health', 'get_pending_changes'] },
  { id: 'aiGaps', tools: ['list_ai_content_gaps', 'get_ai_conversation'] },
  { id: 'draftPage', tools: ['search_pages', 'get_page', 'create_page_draft'] },
] as const satisfies ReadonlyArray<{ id: string; tools: readonly McpToolName[] }>;

type ExamplePromptId = (typeof EXAMPLE_PROMPTS)[number]['id'];

/** The smallest permission level whose scopes cover every tool, or null if none does. */
export function minimumPreset(tools: readonly McpToolName[]): McpKeyPreset | null {
  return MCP_KEY_PRESETS.find((preset) => tools.every((tool) => MCP_PRESET_SCOPES[preset].includes(MCP_TOOL_SCOPES[tool]))) ?? null;
}

export type ExamplePrompt = { id: ExamplePromptId; preset: McpKeyPreset };

/** The examples with the permission each needs, those a read-only assistant can run first. */
export function examplePrompts(): ExamplePrompt[] {
  return EXAMPLE_PROMPTS.map(({ id, tools }) => ({ id, preset: minimumPreset(tools) ?? 'full_admin' })).sort(
    (a, b) => MCP_KEY_PRESETS.indexOf(a.preset) - MCP_KEY_PRESETS.indexOf(b.preset),
  );
}
