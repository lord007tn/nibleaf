import { type AiChatPolicy, aiChatPolicySchema } from '@nibleaf/validators';
import { api } from '@/services/api';

/** The chat's current capture policy, straight from the API and never from a
 * cache: the site shell (and any CDN in front of it) may be minutes old, and
 * each chat turn must carry the revision of the policy its reader was shown. */
export async function fetchChatPolicy(projectId: string, lang?: string, version?: string): Promise<AiChatPolicy> {
  const response = await api.public.sites[':id'].chat.policy.$get(
    { param: { id: projectId }, query: { ...(lang ? { lang } : {}), ...(version ? { version } : {}) } },
    { init: { cache: 'no-store' } },
  );
  if (!response.ok) throw new Error('Chat policy unavailable');
  return aiChatPolicySchema.parse(((await response.json()) as { data: unknown }).data);
}
