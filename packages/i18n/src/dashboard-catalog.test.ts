import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import generatedAliases from './generated/dashboard/message-aliases.json';
import { INTERFACE_LOCALES } from './locales';
import { MESSAGE_IDS } from './message-ids';
import type { MessageFn } from './message-types';
import * as original from './paraglide/messages.js';

describe('dashboard locale generation', () => {
  it.each(INTERFACE_LOCALES)('preserves every message, placeholder and plural in $code', async ({ code }) => {
    const catalog = (await import(`./generated/dashboard/messages/${code}.js`)) as Record<string, MessageFn>;
    const source = JSON.parse(readFileSync(new URL(`../messages/${code}.json`, import.meta.url), 'utf8'));
    for (const id of Object.values(MESSAGE_IDS)) {
      const identifier = (generatedAliases as Record<string, string>)[id] ?? id;
      // biome-ignore lint/performance/noDynamicNamespaceImportAccess: the differential deliberately compares the complete legacy namespace.
      const message = original[id as keyof typeof original] as MessageFn;
      const value = source[id];
      // Fill every declared placeholder with a conspicuous synthetic value.
      const text = JSON.stringify(value);
      const variables = Object.fromEntries([...text.matchAll(/\{(\w+)\}/g)].map((match) => [match[1], 'fixture']));
      for (const count of [0, 1, 2, 3, 11, 100]) {
        const inputs = { ...variables, count: String(count), form: new Intl.PluralRules(code).select(count) };
        expect(catalog[identifier]?.(inputs), `${code}:${id}:${count}`).toBe(message(inputs, { locale: code }));
      }
    }
  });
});
