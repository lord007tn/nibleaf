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
  const orderedKeys = Object.keys(english).filter((key) => key !== '$schema');
  const expectedKeys = [...orderedKeys].sort();

  it.each(INTERFACE_LOCALES.map(({ code }) => code))('%s is key-complete with compatible variables', (locale) => {
    const catalog = loadCatalog(locale);
    expect(
      Object.keys(catalog)
        .filter((key) => key !== '$schema')
        .sort(),
    ).toEqual(expectedKeys);
    for (const key of expectedKeys) expect(placeholders(catalog[key] ?? '')).toEqual(placeholders(english[key] ?? ''));
  });

  it.each(INTERFACE_LOCALES.filter(({ code }) => !['en', 'ar'].includes(code)).map(({ code }) => code))(
    '%s localizes the complete new add-on and managed-consent copy',
    (locale) => {
      const catalog = loadCatalog(locale);
      const firstAddonKey = orderedKeys.indexOf('settings_addons_group_engagement_title');
      const lastAddonKey = orderedKeys.indexOf('settings_addons_boundary');
      const localizedKeys = orderedKeys
        .slice(Math.min(firstAddonKey, lastAddonKey), Math.max(firstAddonKey, lastAddonKey) + 1)
        .filter((key) => !key.endsWith('_placeholder'))
        .concat('settings_analytics_cookieconsent_managed');

      for (const key of localizedKeys) expect(catalog[key]).not.toBe(english[key]);
    },
  );

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
