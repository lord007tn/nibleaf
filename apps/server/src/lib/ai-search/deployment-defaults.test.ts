import { readFile } from 'node:fs/promises';
import { largestChatTurnTokens } from '@nibleaf/search';
import { describe, expect, it, vi } from 'vitest';

describe('self-host chat defaults', () => {
  it('uses the server conversation budget in every deployment example and admits the largest default turn', async () => {
    vi.stubEnv('SEARCH_CHAT_MAX_CONVERSATION_TOKENS', '');
    let budget: number;
    try {
      const { envExtras } = await import('../env-extras');
      budget = envExtras.SEARCH_CHAT_MAX_CONVERSATION_TOKENS;
    } finally {
      vi.unstubAllEnvs();
    }
    const largest = largestChatTurnTokens({ questionMax: 500, historyLimits: { maxMessages: 6, maxTokens: 1500 } });
    expect(budget).toBeGreaterThan(largest);
    for (const name of ['docker-compose.search.yml', 'docker-compose.coolify.yml', '.env.production.example']) {
      const text = await readFile(new URL(`../../../../../${name}`, import.meta.url), 'utf8');
      const match = /SEARCH_CHAT_MAX_CONVERSATION_TOKENS(?:: \$\{SEARCH_CHAT_MAX_CONVERSATION_TOKENS:-|=)(\d+)/u.exec(text);
      expect(Number(match?.[1]), name).toBe(budget);
    }
  });
});
