import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import packageJson from '../package.json' with { type: 'json' };
import { INTERFACE_LOCALES } from './locales';
import { MESSAGE_IDS } from './message-ids';

type Catalog = Record<string, string>;
const messagesDirectory = resolve(import.meta.dirname, '../messages');
const loadCatalog = (locale: string): Catalog => JSON.parse(readFileSync(resolve(messagesDirectory, `${locale}.json`), 'utf8')) as Catalog;
const placeholders = (value: string) => [...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]).sort();

describe('Paraglide message catalogs', () => {
  const english = loadCatalog('en');
  const expectedKeys = Object.keys(english)
    .filter((key) => key !== '$schema')
    .sort();

  it.each(INTERFACE_LOCALES.map(({ code }) => code))('%s is key-complete with compatible variables', (locale) => {
    const catalog = loadCatalog(locale);
    expect(
      Object.keys(catalog)
        .filter((key) => key !== '$schema')
        .sort(),
    ).toEqual(expectedKeys);
    for (const key of expectedKeys) expect(placeholders(catalog[key] ?? '')).toEqual(placeholders(english[key] ?? ''));
  });

  it('maps every stable dotted UI key to a generated message id', () => {
    expect(new Set(Object.values(MESSAGE_IDS)).size).toBe(Object.keys(MESSAGE_IDS).length);
    for (const id of Object.values(MESSAGE_IDS)) expect(english).toHaveProperty(id);
  });

  it('keeps canonical and Vite generation on per-message modules used by direct imports', () => {
    const viteConfig = readFileSync(resolve(import.meta.dirname, '../../../apps/app/vite.config.ts'), 'utf8');
    expect(packageJson.scripts.setup).toContain('--output-structure message-modules');
    expect(viteConfig).toContain("outputStructure: 'message-modules'");
  });
});
