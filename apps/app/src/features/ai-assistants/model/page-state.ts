import { MCP_KEY_PRESETS, MCP_PRESET_MIN_ROLE, type McpKeyPreset, mcpScopesForRole } from '@nibleaf/shared/mcp';
import { canAdminister, roleAtLeast } from '@nibleaf/shared/rbac';

/** What the server says about AI assistant connections (the key list's `meta`). */
export interface AssistantsMeta {
  mcpEnabled: boolean;
  mcpEndpoint: string;
  mcpOAuthEnabled?: boolean;
}

/**
 * A website's limit on what assistants may do (operations/ux/mcp.md D3). Not
 * built yet: `undefined` means no limit beyond the person's role. The model
 * takes it now so the page, the key dialog and the preset reasons don't change
 * shape when it lands.
 */
export interface AssistantPolicy {
  maxPreset?: McpKeyPreset;
}

type PresetBlockReason = 'adminOnly' | 'siteLimit';
export type PresetChoice = { preset: McpKeyPreset; reason: PresetBlockReason | null };

export type AssistantPageState =
  | { kind: 'loading' }
  | { kind: 'loadFailed' }
  /** The server has MCP off: nothing can connect, existing credentials can still be removed. */
  | { kind: 'off'; manageAll: boolean }
  /** This person's role holds no MCP scope (today: a Viewer). */
  | { kind: 'noAccess' }
  | {
      kind: 'ready';
      endpoint: string;
      /** Apps can connect by signing in (OAuth needs an HTTPS public address). */
      signIn: boolean;
      presets: PresetChoice[];
      /** Admins see and remove everyone's connections; others see their own. */
      manageAll: boolean;
    };

const presetRank = (preset: McpKeyPreset) => MCP_KEY_PRESETS.indexOf(preset);

/** Each permission level with the reason this person can't pick it, if any. */
export function presetChoices(role: string, policy: AssistantPolicy = {}): PresetChoice[] {
  return MCP_KEY_PRESETS.map((preset) => ({
    preset,
    reason: !roleAtLeast(role, MCP_PRESET_MIN_ROLE[preset])
      ? 'adminOnly'
      : policy.maxPreset && !canAdminister(role) && presetRank(preset) > presetRank(policy.maxPreset)
        ? 'siteLimit'
        : null,
  }));
}

/** The smallest level this person may pick, used as the key dialog's default after Support writer. */
export function defaultPreset(choices: PresetChoice[]): McpKeyPreset | null {
  const open = choices.filter((choice) => choice.reason === null).map((choice) => choice.preset);
  return open.includes('support_writer') ? 'support_writer' : (open[0] ?? null);
}

/**
 * What the AI assistants page shows. Driven only by what the server reports at
 * runtime (`mcpEnabled`, `mcpOAuthEnabled`) and the person's role, never by
 * which edition of Nibleaf this is.
 */
export function assistantPageState(input: {
  meta: AssistantsMeta | undefined;
  role: string;
  loadFailed: boolean;
  policy?: AssistantPolicy;
}): AssistantPageState {
  const { meta, role, loadFailed, policy } = input;
  if (!meta) return loadFailed ? { kind: 'loadFailed' } : { kind: 'loading' };
  const manageAll = canAdminister(role);
  if (!meta.mcpEnabled) return { kind: 'off', manageAll };
  if (mcpScopesForRole(role).length === 0) return { kind: 'noAccess' };
  return {
    kind: 'ready',
    endpoint: meta.mcpEndpoint,
    signIn: meta.mcpOAuthEnabled === true,
    presets: presetChoices(role, policy),
    manageAll,
  };
}
