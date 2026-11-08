/** What a site's Smart AI settings say about grounded AI answers in search. */
export interface GroundedAnswersInput {
  /** The server has the search index answers are grounded in. */
  infrastructureConfigured: boolean;
  selectedProvider: string;
  instanceConfigured: boolean;
  instanceAnswersEnabled: boolean;
  providers: ReadonlyArray<{ id: string; verified: boolean }>;
}

/**
 * Whether "Grounded AI answers" can be turned on for a site:
 * - `'available'`: the site has a working AI connection (its own verified key,
 *   or the server's key when the server allows answers);
 * - `'needsConnection'`: a site Admin can fix it in Smart AI;
 * - `'needsServer'`: only the server administrator can (no search index);
 * - `'pending'`: not known yet.
 *
 * Before, the switch showed only with the server's own key, so a site that
 * connected its own key never saw it.
 */
export function groundedAnswersState(ai: GroundedAnswersInput | undefined): 'available' | 'needsConnection' | 'needsServer' | 'pending' {
  if (!ai) return 'pending';
  if (!ai.infrastructureConfigured) return 'needsServer';
  if (ai.selectedProvider === 'instance') return ai.instanceConfigured && ai.instanceAnswersEnabled ? 'available' : 'needsConnection';
  return ai.providers.some((provider) => provider.id === ai.selectedProvider && provider.verified) ? 'available' : 'needsConnection';
}
