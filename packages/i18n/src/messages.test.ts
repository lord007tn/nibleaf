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

  it('localizes the counted inbound-link warning in every catalog using plural variants', () => {
    expect(MESSAGE_IDS['editor.deleteInboundLinks']).toBe('editor_deleteinboundlinks');
    for (const { code } of INTERFACE_LOCALES) {
      const catalog = JSON.parse(readFileSync(resolve(messagesDirectory, `${code}.json`), 'utf8'));
      const [message] = catalog.editor_deleteinboundlinks as VariantMessage;
      expect(message?.match['form=*']).toContain('{count}');
      expect(messageText(catalog.editor_deleteinboundlinks)).not.toContain('?');
      if (code !== 'en') expect(messageText(catalog.editor_deleteinboundlinks)).not.toBe(english.editor_deleteinboundlinks);
    }
  });
  const expectedKeys = [...orderedKeys].sort();

  it.each(INTERFACE_LOCALES.map(({ code }) => code))('%s localizes shell recovery and accessible names', (locale) => {
    const catalog = loadCatalog(locale);
    for (const key of [
      'admin_sidebardescription',
      'nav_sidebartitle',
      'nav_sidebardescription',
      'nav_breadcrumb',
      'nav_sitesloaderror',
      'command_pagesloaderror',
      'notifications_bellunreadlabel',
      'notifications_unread',
    ]) {
      expect(catalog[key]?.trim()).toBeTruthy();
      if (locale !== 'en' && key !== 'nav_sidebartitle') expect(catalog[key]).not.toBe(english[key]);
    }
    expect(catalog.notifications_bellunreadlabel).toContain('{count}');
  });

  it('distinguishes server administrators from site Admins in failure instructions', () => {
    const arabic = loadCatalog('ar');
    for (const key of ['failures_toolarge', 'failures_connection', 'failures_unavailable', 'failures_publish', 'failures_export']) {
      expect(english[key]).toContain('your server administrator');
      expect(arabic[key]).toContain('مسؤول الخادم');
      expect(arabic[key]).not.toContain('المسؤول');
    }
    expect(english.failures_access).toContain('a site Admin');
    expect(arabic.failures_access).toContain('مشرف الموقع');
    expect(arabic.failures_access).not.toContain('المسؤول');
  });

  it('gives both Cloud and self-hosted users a support contact in operator-dependent failures', () => {
    const arabic = loadCatalog('ar');
    for (const key of ['failures_toolarge', 'failures_connection', 'failures_unavailable', 'failures_publish', 'failures_export']) {
      expect(english[key]).toContain('Nibleaf support on Cloud');
      expect(english[key]).toContain('if you self-host');
      expect(arabic[key]).toContain('دعم Nibleaf للخدمة السحابية');
      expect(arabic[key]).toContain('مسؤول الخادم للاستضافة الذاتية');
    }
  });

  it('includes non-empty upload-limit copy in every locale and natural Arabic copy', () => {
    const arabic = loadCatalog('ar').editor_pendinguploadlimit;
    expect(arabic).toMatch(/[\u0600-\u06ff]/);
    expect(arabic).not.toBe(english.editor_pendinguploadlimit);
    for (const { code } of INTERFACE_LOCALES) {
      if (code !== 'ar') expect(loadCatalog(code).editor_pendinguploadlimit?.trim()).toBeTruthy();
    }
  });

  it.each(INTERFACE_LOCALES.filter(({ code }) => code !== 'en').map(({ code }) => code))(
    '%s translates the rollback and upload-limit messages that predate the Viewer role',
    (locale) => {
      const catalog = loadCatalog(locale);
      for (const key of ['deploy_rollback_supersededtitle', 'deploy_rollback_superseded', 'editor_pendinguploadlimit']) {
        expect(catalog[key]?.trim()).toBeTruthy();
        expect(catalog[key]).not.toBe(english[key]);
      }
    },
  );

  it('says Smart AI settings apply to this site, as they are stored per site', () => {
    const arabic = loadCatalog('ar');
    const smartAi = orderedKeys.filter((key) => key.startsWith('settings_smartai_'));
    expect(smartAi.filter((key) => /workspace/i.test(english[key] ?? ''))).toEqual([]);
    expect(smartAi.filter((key) => (arabic[key] ?? '').includes('مساحة العمل'))).toEqual([]);
    expect(english.settings_smartai_scope).toContain('this site');
  });

  it('points to the real place to turn on search terms, and drops the contradicted two-way Git note', () => {
    expect(english.analytics_search_hidden_disabled).toContain('Settings → Integrations → Analytics');
    expect(english.analytics_search_enable_offlater).toContain('Settings → Integrations → Analytics');
    expect(english).not.toHaveProperty('settings_git_twowaysync_description');
  });

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

  it.each(INTERFACE_LOCALES.map(({ code }) => code))('%s gives every variant message a catch-all form', (locale) => {
    const raw = JSON.parse(readFileSync(resolve(messagesDirectory, `${locale}.json`), 'utf8')) as Record<string, string | VariantMessage>;
    const missing = Object.entries(raw)
      .filter((entry): entry is [string, VariantMessage] => Array.isArray(entry[1]))
      .filter(
        ([, variants]) =>
          !variants.every((variant) => Object.keys(variant.match).some((key) => key.split(',').every((part) => part.trim().endsWith('=*')))),
      )
      .map(([key]) => key);
    // Without `form=*` a count with no matching category would render nothing.
    expect(missing).toEqual([]);
  });

  it('maps every stable dotted UI key to a generated message id', () => {
    expect(new Set(Object.values(MESSAGE_IDS)).size).toBe(Object.keys(MESSAGE_IDS).length);
    for (const id of Object.values(MESSAGE_IDS)) expect(english).toHaveProperty(id);
  });

  it('keeps canonical and Vite generation on per-message modules used by direct imports', () => {
    const viteConfig = readFileSync(resolve(import.meta.dirname, '../../../apps/app/vite.config.ts'), 'utf8');
    expect(packageJson.scripts.setup).toContain('--output-structure message-modules');
    expect(viteConfig).toContain("outputStructure: 'message-modules'");
    const adminViteConfig = readFileSync(resolve(import.meta.dirname, '../../../apps/admin/vite.config.ts'), 'utf8');
    expect(adminViteConfig).toContain("outputStructure: 'message-modules'");
  });
});

describe('dashboard safety copy', () => {
  it('uses consistent Arabic role names', () => {
    const ar = loadCatalog('ar');
    expect(ar.roles_admin).toBe('مشرف');
    expect(ar.roles_owner).toBe('المالك');
    expect(ar.roles_editor).toBe('محرّر');
    expect(ar.roles_viewer).toBe('مشاهد');
    for (const key of [
      'settings_apikeys_adminonly',
      'settings_members_roleshint',
      'settings_danger_transfer_description',
      'settings_danger_transfer_confirm',
      'settings_permissions_title',
      'settings_permissions_body',
      'settings_permissions_viewerbody',
      'access_viewonly_body',
      'access_viewonly_action',
      'access_viewonly_publish',
    ]) {
      expect(ar[key]).toMatch(/مشرف/);
      expect(ar[key]).not.toMatch(/مسؤول|مدير/);
    }
  });

  it('explains immediate credential invalidation and default URL language changes in both supported catalogs', () => {
    const en = loadCatalog('en');
    const ar = loadCatalog('ar');
    expect(en.settings_apikeys_rotateconfirm_description).toMatch(/immediately/);
    expect(en.settings_git_workflow_rotateconfirm_description).toMatch(/immediately/);
    expect(en.settings_languages_defaultconfirm_description).toMatch(/without a language prefix/);
    for (const key of [
      'settings_apikeys_rotateconfirm_description',
      'settings_git_workflow_rotateconfirm_description',
      'settings_languages_defaultconfirm_description',
      'settings_smartai_disableconfirm_description',
      'settings_danger_transfer_noadmins',
    ]) {
      expect(ar[key]).toMatch(/[ء-ي]/);
      expect(ar[key]).not.toBe(en[key]);
    }
  });
});

it('keeps the settings arrow and replacement warnings clear in English, Arabic and fallback catalogs', () => {
  for (const { code } of INTERFACE_LOCALES.filter(
    ({ code }) => !['ar', 'de', 'fr', 'es', 'pt-BR', 'ru', 'id', 'zh-CN', 'hi', 'bn', 'ur'].includes(code),
  )) {
    expect(loadCatalog(code).preview_disabledaskadmin).toContain('Settings → Add-ons');
  }
  expect(loadCatalog('de').preview_disabledaskadmin).toContain('Einstellungen → Add-ons');
  expect(loadCatalog('fr').preview_disabledaskadmin).toContain('Paramètres → Modules complémentaires');
  expect(loadCatalog('es').preview_disabledaskadmin).toContain('Configuración → Complementos');
  expect(loadCatalog('pt-BR').preview_disabledaskadmin).toContain('Configurações → Complementos');
  expect(loadCatalog('ru').preview_disabledaskadmin).toContain('«Настройки → Дополнения»');
  expect(loadCatalog('id').preview_disabledaskadmin).toContain('Pengaturan → Pengaya');
  expect(loadCatalog('zh-CN').preview_disabledaskadmin).toContain('设置 → 附加组件');
  expect(loadCatalog('hi').preview_disabledaskadmin).toContain('सेटिंग्स → ऐड-ऑन');
  expect(loadCatalog('bn').preview_disabledaskadmin).toContain('সেটিংস → অ্যাড-অন');
  expect(loadCatalog('ur').preview_disabledaskadmin).toContain('ترتیبات ← ایڈ آنز');
  expect(loadCatalog('en').settings_git_workflow_rotateconfirm_title).toBe('Replace the webhook secret?');
  expect(loadCatalog('ar').settings_git_workflow_rotateconfirm_title).toBe('هل تريد استبدال سر الإشعارات الواردة؟');
  expect(loadCatalog('en').settings_apikeys_rotateconfirm_expireddescription).toContain('The new key will expire in 90 days.');
  expect(loadCatalog('ar').settings_apikeys_rotateconfirm_expireddescription).toContain('90 يومًا');
});

it('uses the glossary Admin role in English settings permission guidance', () => {
  expect(loadCatalog('en').settings_permissions_body).toContain('Admin');
  expect(loadCatalog('en').settings_permissions_body).not.toContain('administrator');
});

it('gives Cloud and self-hosted users the right contact when conversation saving is unavailable', () => {
  const english = loadCatalog('en').dashboard_ai_captureinstance;
  expect(english).toContain('Questions are not being saved');
  expect(english).toContain('Nibleaf support on Cloud');
  expect(english).toContain('server administrator if you self-host');
  expect(english).not.toContain('encryption key');
  expect(loadCatalog('ar').dashboard_ai_captureinstance).toContain('دعم Nibleaf');
});

it('localizes the compact checklist permission failure in Arabic and uses English for fallback locales', () => {
  const english = loadCatalog('en').overview_nudge_permissionserror;
  expect(english).toBe("Couldn't check your permissions.");
  expect(loadCatalog('ar').overview_nudge_permissionserror).toBe('تعذّر التحقق من صلاحياتك.');
  expect(loadCatalog('de').overview_nudge_permissionserror).toBe('Ihre Berechtigungen konnten nicht geprüft werden.');
  expect(loadCatalog('fr').overview_nudge_permissionserror).toBe('Impossible de vérifier vos autorisations.');
  expect(loadCatalog('es').overview_nudge_permissionserror).toBe('No se pudieron comprobar tus permisos.');
  expect(loadCatalog('pt-BR').overview_nudge_permissionserror).toBe('Não foi possível verificar suas permissões.');
  expect(loadCatalog('ru').overview_nudge_permissionserror).toBe('Не удалось проверить ваши права.');
  expect(loadCatalog('id').overview_nudge_permissionserror).toBe('Tidak dapat memeriksa izin Anda.');
  expect(loadCatalog('zh-CN').overview_nudge_permissionserror).toBe('无法检查你的权限。');
  expect(loadCatalog('hi').overview_nudge_permissionserror).toBe('आपकी अनुमतियाँ जाँची नहीं जा सकीं।');
  expect(loadCatalog('bn').overview_nudge_permissionserror).toBe('আপনার অনুমতি যাচাই করা যায়নি।');
  expect(loadCatalog('ur').overview_nudge_permissionserror).toBe('آپ کی اجازتیں جانچی نہیں جا سکیں۔');
  for (const { code } of INTERFACE_LOCALES.filter(
    ({ code }) => !['ar', 'de', 'fr', 'es', 'pt-BR', 'ru', 'id', 'zh-CN', 'hi', 'bn', 'ur'].includes(code),
  )) {
    expect(loadCatalog(code).overview_nudge_permissionserror).toBe(english);
  }
});

it('never promises that saved Ask AI conversations are anonymized, in any locale', () => {
  // Redaction removes emails, phone-like numbers, long digit runs, keys and URL
  // queries; names and street addresses pass through, so consent must say so.
  const english = loadCatalog('en');
  const key = 'oauth_consent_can_aiconversations';
  expect(english[key]).toMatch(/may remain/);
  expect(english[key]).not.toMatch(/personal details removed|anonymi[sz]/i);
  expect(loadCatalog('ar')[key]).toContain('قد تبقى');
  for (const { code } of INTERFACE_LOCALES) {
    const value = loadCatalog(code)[key];
    expect(value, code).toBeTruthy();
    if (code !== 'en') expect(value, code).not.toBe(english[key]);
  }
});
