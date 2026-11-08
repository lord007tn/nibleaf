import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const ids = [
  'analytics_status_readsdisabled_title',
  'analytics_status_readsdisabled_body',
  'publish_reviewchanged',
  'admin_pagination_first',
  'admin_pagination_next',
];
it.each(['en', 'ar', 'bn', 'de', 'es', 'fr', 'hi', 'id', 'pt-BR', 'ru', 'ur', 'zh-CN'])(
  'ships intact analytics and operations copy in %s',
  (locale) => {
    const messages = JSON.parse(readFileSync(new URL(`../messages/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
    for (const id of ids) {
      expect(messages[id]?.length).toBeGreaterThan(0);
      expect(messages[id]).not.toMatch(/\?{2}/);
      if (locale === 'ar') expect(messages[id]).toMatch(/\p{Script=Arabic}/u);
    }
  },
);
