import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import packageJson from '../package.json' with { type: 'json' };
import { INTERFACE_LOCALES } from './locales';
import { MESSAGE_IDS } from './message-ids';

type Catalog = Record<string, string>;
type VariantMessage = Array<{ match: Record<string, string> }>;
const messagesDirectory = resolve(import.meta.dirname, '../messages');
/** A variant message (plural forms) reads as its variants' text, one per line. */
const messageText = (value: string | VariantMessage): string =>
  typeof value === 'string' ? value : value.flatMap((message) => Object.values(message.match)).join('\n');
const loadCatalog = (locale: string): Catalog =>
  Object.fromEntries(
    Object.entries(JSON.parse(readFileSync(resolve(messagesDirectory, `${locale}.json`), 'utf8')) as Record<string, string | VariantMessage>).map(
      ([key, value]) => [key, messageText(value)],
    ),
  );
// Variable names only: a plural form may spell its number out ("صفحتان").
const placeholders = (value: string) => [...new Set([...value.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((match) => match[1]))].sort();

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

  it.each(INTERFACE_LOCALES.map(({ code }) => code))('%s contains no external translation-service artifacts', (locale) => {
    expect(Object.values(loadCatalog(locale)).join('\n')).not.toMatch(/NO QUERY|EXAMPLE REQUEST|LANGPAIR|GET\?Q=|MYMEMORY|translated\.net/i);
  });

  it.each(INTERFACE_LOCALES.map(({ code }) => code))('%s keeps integration copy free of translation artifacts', (locale) => {
    const integrationCopy = Object.entries(loadCatalog(locale))
      .filter(([key]) => key.startsWith('settings_integrations_'))
      .map(([, value]) => value)
      .join('\n');

    expect(integrationCopy).not.toMatch(/@ info|\bName\b|NO QUERY|EXAMPLE REQUEST|LANGPAIR|GET\?Q=/);
    expect(integrationCopy).not.toMatch(/مثال|দৃষ্টান্ত|Пример Нибулафа|Exemplo Nibleaf/);
  });

  it.each(INTERFACE_LOCALES.map(({ code }) => code))('%s keeps opposite integration states distinct', (locale) => {
    const catalog = loadCatalog(locale);
    const pairs = [
      ['settings_integrations_connected', 'settings_integrations_notconnected'],
      ['settings_integrations_health_healthy', 'settings_integrations_health_unhealthy'],
      ['settings_integrations_status_active', 'settings_integrations_status_inactive'],
      ['settings_integrations_availability_available', 'settings_integrations_availability_unavailable'],
    ] as const;

    for (const [positive, negative] of pairs) expect(catalog[positive]).not.toBe(catalog[negative]);
  });

  it.each(INTERFACE_LOCALES.filter(({ code }) => code !== 'en').map(({ code }) => code))(
    '%s preserves integration provider and product names',
    (locale) => {
      const catalog = loadCatalog(locale);
      const protectedNames = [
        'Amazon S3',
        'Backblaze B2',
        'ClickHouse',
        'Cloudflare',
        'Cloudflare R2',
        'Discord',
        'GitHub',
        'GitLab',
        'Google Analytics',
        'Maxio',
        'MinIO',
        'Nibleaf',
        'OpenRouter',
        'Plausible',
        'Postmark',
        'Public Git',
        'Qdrant',
        'Slack',
        'SMTP',
        'Zapier',
      ];

      for (const [key, englishValue] of Object.entries(english)) {
        if (!key.startsWith('settings_integrations_')) continue;
        for (const protectedName of protectedNames) {
          if (englishValue.includes(protectedName)) expect(catalog[key]).toContain(protectedName);
        }
      }
    },
  );

  it('keeps Bengali and Urdu integration terminology semantically distinct', () => {
    expect(loadCatalog('bn')).toMatchObject({
      settings_integrations_title: 'ইন্টিগ্রেশনসমূহ',
      settings_integrations_configuration: 'কনফিগারেশন',
      settings_integrations_connected: 'সংযুক্ত',
      settings_integrations_notconnected: 'সংযুক্ত নয়',
      settings_integrations_connect: 'সংযুক্ত করুন',
      settings_integrations_manage: 'পরিচালনা করুন',
      settings_integrations_value_runtime_hybrid: 'হাইব্রিড',
      settings_integrations_value_mode_dualwrite: 'দ্বৈত লেখা',
      settings_integrations_value_mode_shadowread: 'ছায়া পাঠ',
    });
    expect(loadCatalog('ur')).toMatchObject({
      settings_integrations_title: 'انضمامات',
      settings_integrations_configuration: 'ترتیبات',
      settings_integrations_connected: 'منسلک',
      settings_integrations_notconnected: 'منسلک نہیں',
      settings_integrations_connect: 'منسلک کریں',
      settings_integrations_manage: 'انتظام کریں',
      settings_integrations_value_runtime_hybrid: 'ہائبرڈ',
      settings_integrations_value_mode_dualwrite: 'دوہری تحریر',
      settings_integrations_value_mode_shadowread: 'شیڈو ریڈ',
    });
  });

  it.each(INTERFACE_LOCALES.filter(({ code }) => !['en', 'ar'].includes(code)).map(({ code }) => code))(
    '%s localizes the integration settings surface without English fallbacks',
    (locale) => {
      const catalog = loadCatalog(locale);
      const intentionallyIdentical = new Set([
        ...orderedKeys.filter((key) => key.startsWith('settings_integrations_provider_')),
        ...orderedKeys.filter((key) => key.startsWith('settings_integrations_placeholder_')),
        'settings_integrations_value_mode_clickhouse',
      ]);
      const integrationKeys = orderedKeys.filter((key) => key.startsWith('settings_integrations_') && !intentionallyIdentical.has(key));

      for (const key of integrationKeys) expect(catalog[key]).not.toBe(english[key]);
    },
  );

  it('translates every reader chat string for Arabic readers', () => {
    const arabic = loadCatalog('ar');
    // The chat panel's own copy; a string left in English is read out by Arabic screen readers.
    const chat = orderedKeys.filter((key) => key.startsWith('site_ai_'));
    expect(chat.length).toBeGreaterThan(40);
    expect(chat.filter((key) => arabic[key] === english[key])).toEqual([]);
  });

  it('addresses German readers formally (Sie), never with du', () => {
    const german = loadCatalog('de');
    // Informal (du-form) imperatives opening a sentence or a short label such as "Gehe zu".
    // Formal copy says "Gehen Sie …" or uses an infinitive ("Wechseln zu"). Nouns that look
    // like these verbs ("Suche", "Stelle") are left out, so only "Suche nach" counts.
    const imperatives = [
      'Aktiviere',
      'Aktualisiere',
      'Bearbeite',
      'Benenne',
      'Bestätige',
      'Deaktiviere',
      'Entferne',
      'Erstelle',
      'Füge',
      'Gehe',
      'Gib',
      'Halte',
      'Klicke',
      'Kopiere',
      'Lade',
      'Lass',
      'Lege',
      'Lies',
      'Lösche',
      'Mach',
      'Melde',
      'Nimm',
      'Nutze',
      'Öffne',
      'Prüfe',
      'Richte',
      'Schau',
      'Schreibe',
      'Sende',
      'Sieh',
      'Speichere',
      'Starte',
      'Suche nach',
      'Teile',
      'Trage',
      'Überprüfe',
      'Verwende',
      'Veröffentliche',
      'Versuche',
      'Wähle',
      'Warte',
      'Wechsle',
      'Wiederhole',
      'Ziehe',
      'Ändere',
    ];
    const informalImperative = new RegExp(`(^|[.!?:] )(${imperatives.join('|')})(?=[\\s.,!?]|$)`);
    // Blog articles are English-only source copy; everything else is interface text.
    const informal = Object.entries(german).filter(
      ([key, value]) => !key.startsWith('blog_') && (/\b(du|dich|dir|dein\w*|euch|euer\w*)\b/i.test(value) || informalImperative.test(value)),
    );
    expect(informal.map(([key]) => key)).toEqual([]);
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
