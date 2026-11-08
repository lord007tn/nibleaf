import { readFile } from 'node:fs/promises';
import { largestChatTurnTokens } from '@nibleaf/search';
import { describe, expect, it } from 'vitest';

describe('self-host chat defaults', () => {
  it('admits the largest default turn in every current-source deployment example', async () => {
    const largest = largestChatTurnTokens({ questionMax: 500, historyLimits: { maxMessages: 6, maxTokens: 1500 } });
    for (const name of ['docker-compose.search.yml', 'docker-compose.coolify.yml', '.env.production.example']) {
      const text = await readFile(new URL(`../../../../../${name}`, import.meta.url), 'utf8');
      const match = /SEARCH_CHAT_MAX_CONVERSATION_TOKENS(?:: \$\{SEARCH_CHAT_MAX_CONVERSATION_TOKENS:-|=)(\d+)/u.exec(text);
      expect(Number(match?.[1]), name).toBe(150_000);
      expect(Number(match?.[1]), name).toBeGreaterThan(largest);
    }
  });
});
