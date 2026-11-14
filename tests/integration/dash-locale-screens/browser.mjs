// Per-locale captures of four dense dashboard screens for the translation PRs:
// Site settings (General), Site analytics (Overview), the organization's People
// page and the Publish sheet, at 1440×1000 and 390×844 (touch), light theme.
// The actual signed-in shell and routes (apps/app/scripts/dash-locale-screens.fixture.tsx)
// with fictional API answers served by request interception. No server, port,
// database or real site is used.
//
//   LOCALES=de,fr   which interface locales (default: every locale in project.inlang)
//   OUT=<dir>       where the PNGs and evidence.json go (default .github/assets/i18n-<locales>)
//   AXE_CORE=<path> axe.min.js: also run axe's color-contrast rule (optional)
//   ONLY=<screen>[,…] narrows a debugging run; DEBUG_CAPTURE=1 builds unminified.
//
// evidence.json lists, per capture: page errors, horizontal overflow, <html lang dir>,
// clipped controls and visible English leftovers (see README.md).
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireDevstackLock, hostKey, withLocalOnlyBrowser } from '../lib/capture-env.mjs';

const root = resolve(import.meta.dirname, '../../..');
const appDir = resolve(root, 'apps/app');
const i18nDir = resolve(root, 'packages/i18n');
const appRequire = createRequire(resolve(appDir, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(appRequire.resolve(name)).href);
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

const allLocales = (await readJson(resolve(i18nDir, 'project.inlang/settings.json'))).locales;
const locales = process.env.LOCALES ? process.env.LOCALES.split(',').map((code) => code.trim()) : allLocales;
for (const locale of locales) assert.ok(allLocales.includes(locale), `${locale} is one of ${allLocales.join(', ')}`);
const output = resolve(root, process.env.OUT ?? `.github/assets/i18n-${locales.join('-')}`);
const axeSource = process.env.AXE_CORE ? await readFile(process.env.AXE_CORE, 'utf8') : null;
const glossaryFile = resolve(i18nDir, 'glossary/terms.json');
const doNotTranslate = existsSync(glossaryFile) ? ((await readJson(glossaryFile)).doNotTranslate ?? []) : [];
// Keys a locale keeps identical to English on purpose (untranslated/<locale>.json),
// the same exceptions the CI guard accepts: their text is the locale's own.
const sameAsEnglish = async (locale) => {
  const file = resolve(i18nDir, `untranslated/${locale}.json`);
  return existsSync(file) ? ((await readJson(file)).sameAsEnglish ?? []) : [];
};
// Never listened on: every request to it is answered by page.route below.
const origin = 'http://fixture.nibleaf.test';
const RTL = new Set(['ar', 'ur']);

/** A catalog's text per key: plain strings, plus each variant of a plural/select message. */
const templates = (value) => {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.flatMap((variant) => Object.values(variant?.match ?? {}).filter((text) => typeof text === 'string'));
};
const catalogTexts = async (locale) => {
  const catalog = await readJson(resolve(i18nDir, `messages/${locale}.json`));
  return Object.fromEntries(
    Object.entries(catalog)
      .filter(([key]) => !key.startsWith('$'))
      .map(([key, value]) => [key, templates(value)]),
  );
};
const english = await catalogTexts('en');
const catalogs = Object.fromEntries(await Promise.all(locales.map(async (locale) => [locale, await catalogTexts(locale)])));
const plain = (catalog, key) => {
  const [text] = catalog[key] ?? [];
  return typeof text === 'string' ? text : undefined;
};

// ─── Fictional data: the site "Team handbook" in the organization "Acme Docs" ───

const date = '2026-11-12T00:00:00.000Z';
// People and invitations relative to the run, so "last active" and expiry never age into another state.
const now = Date.now();
const daysAgo = (days) => new Date(now - days * 86_400_000).toISOString();
const fresh = new Date(Date.now() - 5 * 60_000).toISOString();
const series = (values) => values.map((value, index) => ({ bucket: `2026-11-${String(index + 1).padStart(2, '0')}`, value }));
const meta = {
  availability: 'complete',
  timezone: 'UTC',
  current: { from: '2026-10-14T00:00:00.000Z', to: '2026-11-13T00:00:00.000Z' },
  previous: { from: '2026-09-14T00:00:00.000Z', to: '2026-10-14T00:00:00.000Z' },
  granularity: 'day',
  generatedAt: date,
  lastEventAt: fresh,
};
const acme = { id: 'org-acme', slug: 'acme', name: 'Acme Docs', logo: null, orgRole: 'owner', canCreateWebsite: true, sendInvitationEmails: true };
const handbook = {
  id: 'handbook',
  organizationId: acme.id,
  name: 'Team handbook',
  slug: 'team-handbook',
  description: 'How the Acme Docs team plans, writes and ships documentation.',
  icon: null,
  config: {},
  languages: [],
  createdAt: date,
  updatedAt: date,
  readyPublishes: 14,
  hasPublishedVersion: true,
  role: 'owner',
  domain: null,
};
const runbooks = { ...handbook, id: 'runbooks', name: 'On-call runbooks', slug: 'on-call-runbooks', description: null, readyPublishes: 6 };
const owner = { id: 'owner', name: 'Mara Lindqvist', email: 'mara.lindqvist@example.test', image: null };
const people = [
  [owner, 'owner', null, 0],
  [{ id: 'u-tomas', name: 'Tomás Herrera', email: 'tomas.herrera@example.test', image: null }, 'admin', null, 1],
  [{ id: 'u-priya', name: 'Priya Raman', email: 'priya.raman@example.test', image: null }, 'admin', 'admin', 3],
  [{ id: 'u-jonas', name: 'Jonas Becker', email: 'jonas.becker@example.test', image: null }, 'member', 'member', 2],
  [{ id: 'u-amina', name: 'Amina Okafor', email: 'amina.okafor@example.test', image: null }, 'member', 'viewer', 9],
  [{ id: 'u-li', name: 'Li Wei', email: 'li.wei@example.test', image: null }, 'member', 'member', null],
  [{ id: 'u-sofia', name: 'Sofia Marchetti', email: 'sofia.marchetti@example.test', image: null }, 'member', 'viewer', 21],
];
const orgMembers = people.map(([user, orgRole, siteRole, lastActive], index) => ({
  id: `m-${user.id}`,
  userId: user.id,
  orgRole,
  createdAt: daysAgo(200 - index * 20),
  lastActiveAt: lastActive === null ? null : daysAgo(lastActive),
  user,
  projectGrants: siteRole
    ? [
        { projectId: handbook.id, role: siteRole, project: { id: handbook.id, name: handbook.name } },
        ...(index % 2 ? [{ projectId: runbooks.id, role: 'viewer', project: { id: runbooks.id, name: runbooks.name } }] : []),
      ]
    : [],
}));
const inviter = { id: owner.id, name: owner.name, email: owner.email };
const orgInvitations = [
  ['noah.fischer@example.test', 'member', 'member', 1],
  ['camille.dubois@example.test', 'admin', null, 2],
  ['kenji.sato@example.test', 'member', 'viewer', 5],
].map(([email, orgRole, siteRole, age], index) => ({
  id: `inv-${index}`,
  email,
  orgRole,
  createdAt: daysAgo(age),
  expiresAt: daysAgo(age - 7),
  inviter,
  grants: siteRole ? [{ projectId: handbook.id, role: siteRole, project: { name: handbook.name } }] : [],
}));
const siteMembers = {
  members: orgMembers
    .filter((member) => member.projectGrants.some((grant) => grant.projectId === handbook.id) || member.orgRole !== 'member')
    .map((member) => ({
      id: member.id,
      role: member.projectGrants.find((grant) => grant.projectId === handbook.id)?.role ?? member.orgRole,
      user: member.user,
    })),
  invitations: [],
};
const pageViews = [420, 438, 391, 512, 560, 301, 288, 604, 633, 590, 655, 702, 341, 330];
const overview = {
  meta,
  kpis: {
    pageViews: { value: 18_420, previous: 15_310 },
    visits: { value: 6912, previous: 6240 },
    avgEngagedMs: { value: 97_000, previous: 84_000 },
    avgScrollDepth: { value: 0.64, previous: 0.6 },
    searches: { value: 2318, previous: 1970 },
    searchSuccessRate: { value: 0.71, previous: 0.74 },
    zeroResultRate: { value: 0.13, previous: 0.09 },
    helpfulRate: { value: 0.82, previous: 0.79 },
    aiAssistantVisits: { value: 412, previous: 236 },
    aiCrawlerRequests: { value: 9840, previous: 6110 },
  },
  pageViewsSeries: series(pageViews),
  previousPageViewsSeries: series(pageViews.map((value) => Math.round(value * 0.82))),
  topPages: [
    ['onboarding/first-week', 'Your first week', 3120, 2870],
    ['process/release-checklist', 'Release checklist', 2204, 1980],
    ['writing/style-rules', 'House style rules', 1876, 1910],
    ['tools/editor-setup', 'Editor setup', 1402, 1120],
    ['process/review-flow', 'How reviews work', 1188, null],
    ['people/time-off', 'Planning time off', 964, 1002],
  ].map(([path, title, views, previousViews]) => ({ path, title, views, previousViews })),
  pagesNeedingWork: [
    {
      path: 'tools/vpn-access',
      title: 'VPN access',
      views: 812,
      reasons: ['low_helpfulness', 'search_bounce'],
      helpfulRate: 0.41,
      exitRate: 0.58,
      avgEngagedMs: 21_000,
    },
    {
      path: 'process/incident-roles',
      title: 'Incident roles',
      views: 640,
      reasons: ['high_exit'],
      helpfulRate: 0.7,
      exitRate: 0.71,
      avgEngagedMs: 45_000,
    },
    {
      path: 'tools/laptop-refresh',
      title: 'Laptop refresh',
      views: 377,
      reasons: ['slow', 'low_engagement'],
      helpfulRate: null,
      exitRate: 0.44,
      avgEngagedMs: 12_000,
    },
  ],
  failedSearches: [
    ['expense report', 'f1', 64, 51, 39],
    ['parental leave', 'f2', 41, 37, 30],
    ['staging password', 'f3', 28, 22, 28],
    ['holiday calendar', 'f4', 19, 17, 15],
  ].map(([term, termId, searches, visits, zeroResultSearches]) => ({
    term,
    termId,
    searches,
    visits,
    zeroResultSearches,
    clickThroughRate: 0.08,
    refinementRate: 0.41,
    averageClickPosition: null,
    topResultPath: null,
  })),
  searchTermsVisibility: 'visible',
  channels: [
    ['direct', 2930, 2710],
    ['search', 1904, 1780],
    ['internal', 1102, 990],
    ['ai_assistant', 412, 236],
    ['referral', 388, 402],
    ['social', 176, 122],
  ].map(([channel, visits, previousVisits]) => ({ channel, visits, previousVisits })),
  feedback: { helpful: 342, notHelpful: 75 },
};
const lines = (pairs) =>
  pairs.map(([type, text], index) => ({ type, text, oldLine: type === 'added' ? null : index + 1, newLine: type === 'removed' ? null : index + 1 }));
const change = (id, title, path, status, additions, deletions, diff) => ({
  id,
  title,
  path,
  languageCode: 'en',
  kind: 'PAGE',
  status,
  fields: status === 'modified' ? ['content'] : [],
  additions,
  deletions,
  lines: lines(diff),
  truncated: false,
});
const pendingChanges = {
  hasRealContent: true,
  hasBaseline: true,
  upToDate: false,
  changes: [
    change('p-release', 'Release checklist', 'process/release-checklist', 'modified', 2, 1, [
      ['unchanged', '## Before the release'],
      ['removed', 'Ask in the team channel who is on call.'],
      ['added', 'Check the on-call rota before you start.'],
      ['added', 'Post the release window in the team channel.'],
      ['unchanged', 'Freeze merges one hour before.'],
    ]),
    change('p-vpn', 'VPN access', 'tools/vpn-access', 'modified', 1, 1, [
      ['removed', 'Request access from the IT desk.'],
      ['added', 'Request access from the IT desk with your laptop serial number.'],
    ]),
    change('p-mentors', 'Onboarding mentors', 'onboarding/mentors', 'added', 3, 0, [
      ['added', '# Onboarding mentors'],
      ['added', 'Every new teammate gets a mentor for their first month.'],
      ['added', 'Mentors meet them twice a week.'],
    ]),
    change('p-fax', 'Sending a fax', 'tools/fax', 'removed', 0, 2, [
      ['removed', '# Sending a fax'],
      ['removed', 'Use the machine on the second floor.'],
    ]),
  ],
  checks: [
    {
      code: 'broken-internal-link',
      severity: 'warning',
      pageId: 'p-release',
      languageCode: 'en',
      title: 'Release checklist',
      path: 'process/release-checklist',
      detail: '/process/rollback-plan',
    },
    {
      code: 'missing-alt',
      severity: 'warning',
      pageId: 'p-mentors',
      languageCode: 'en',
      title: 'Onboarding mentors',
      path: 'onboarding/mentors',
      detail: 'mentor-pairs.png',
    },
    {
      code: 'duplicate-title',
      severity: 'warning',
      pageId: 'p-vpn',
      languageCode: 'en',
      title: 'VPN access',
      path: 'tools/vpn-access',
      detail: 'tools/remote-access',
    },
  ],
  redirectIssues: [],
  reviewedStateHash: 'fixture',
};
const switcher = {
  organizations: [{ ...acme, websiteCount: 2 }],
  recent: [
    { id: handbook.id, name: handbook.name, icon: null, domain: null, live: true, organization: { id: acme.id, slug: acme.slug, name: acme.name } },
  ],
  landing: { id: acme.id, slug: acme.slug },
};
const site = `/api/app/projects/${handbook.id}`;
const org = `/api/app/organizations/${acme.id}`;
/** The JSON answer for an API path; `null` = not part of this fixture. */
const answer = (pathname) => {
  const data = (value) => ({ json: { data: value } });
  switch (pathname) {
    case '/api/auth/get-session':
      return {
        json: {
          session: { id: 'fixture', userId: owner.id, expiresAt: '2099-01-01T00:00:00.000Z' },
          user: { ...owner, emailVerified: true, createdAt: date, updatedAt: date },
        },
      };
    case '/api/app/me/switcher':
      return data(switcher);
    case `/api/app/organizations/by-slug/${acme.slug}`:
      return data({ ...acme, administrators: [{ name: owner.name }, { name: 'Tomás Herrera' }, { name: 'Priya Raman' }] });
    case '/api/app/projects':
    case `${org}/projects`:
      return data([handbook, runbooks]);
    case site:
      return data(handbook);
    case '/api/app/notifications/unread-count':
      return data({ count: 3 });
    case `${site}/members`:
      return data(siteMembers);
    case `${org}/members`:
      return data(orgMembers);
    case `${org}/invitations`:
      return data(orgInvitations);
    case `${site}/branches`:
      return data([{ id: 'main', projectId: handbook.id, name: 'main', isDefault: true, forkedAt: null, createdAt: date, updatedAt: date }]);
    case `${site}/deployments/changes`:
      return data(pendingChanges);
    // Lists these screens read but show no rows from.
    case `${site}/languages`:
    case `${site}/pages`:
    case `${site}/deployments`:
    case `${site}/domains`:
    case `${org}/join-links`:
      return data([]);
    case `${site}/analytics/insights/overview`:
      return data(overview);
    default:
      return null;
  }
};

/** Every string of the fictional data: names and titles are never counted as English leftovers. */
const strings = (value) => (typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []);
const fixtureTexts = [...new Set(strings([acme, handbook, runbooks, orgMembers, orgInvitations, siteMembers, overview, pendingChanges, switcher]))];

// ─── Screens ───

const screens = [
  { key: 'settings', path: `/app/projects/${handbook.id}/settings?section=general` },
  { key: 'analytics', path: `/app/projects/${handbook.id}/analytics` },
  { key: 'people', path: `/app/o/${acme.slug}/members` },
  // Opened from the header's Publish control on the analytics page.
  { key: 'publish', path: `/app/projects/${handbook.id}/analytics`, publish: true },
];
const sizes = [
  { width: 1440, height: 1000, mobile: false },
  { width: 390, height: 844, mobile: true },
];

/** In the page, once settled: the evidence for one capture. */
function inspect({ scope, base, english, local, doNotTranslate, fixtureTexts, sameKeys }) {
  const container = (scope && document.querySelector(scope)) || document.body;
  const normal = (text) => text.replace(/\s+/g, ' ').trim();
  const letters = (text) => (text.match(/\p{L}/gu) ?? []).length;
  const visible = (element) => {
    if (!element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    // Visually hidden (sr-only: a skip link until it has focus).
    const style = getComputedStyle(element);
    if (style.clipPath === 'inset(50%)' || style.clip === 'rect(0px, 0px, 0px, 0px)') return false;
    const rect = element.getBoundingClientRect();
    // Off-screen (a skip link waiting for focus) is not shown.
    return rect.width > 1 && rect.height > 1 && rect.bottom > 0 && rect.right > 0 && rect.left < innerWidth;
  };

  // Clipped controls: buttons, tabs, and links in a tab row whose text is cut
  // off, or that stick out of their parent row (a scrolling row excluded).
  const tabRows = '[role="tablist"], nav[data-slot="section-tabs"]';
  const controls = [...container.querySelectorAll(`button, [role="tab"], :is(${tabRows}) a`)].filter(
    (element, index, all) => all.indexOf(element) === index && visible(element),
  );
  const scrolls = (element) => /auto|scroll/.test(getComputedStyle(element).overflowX);
  const clipped = [];
  for (const control of controls) {
    const text = normal(control.textContent ?? '') || control.getAttribute('aria-label') || '';
    const truncated = [control, ...control.querySelectorAll('*')].find(
      (element) => visible(element) && element.scrollWidth > element.clientWidth + 1 && getComputedStyle(element).overflowX !== 'visible',
    );
    const parent = control.parentElement;
    const own = control.getBoundingClientRect();
    const row = parent?.getBoundingClientRect();
    const style = getComputedStyle(control);
    // A negative margin (a hit area larger than the icon, `-m-1`) sticks out on purpose.
    const slack = 1 + Math.max(0, -Number.parseFloat(style.marginLeft), -Number.parseFloat(style.marginRight));
    const overflowsParent = Boolean(
      parent &&
        row &&
        !scrolls(parent) &&
        !/absolute|fixed/.test(style.position) &&
        row.width > 0 &&
        (own.right > row.right + slack || own.left < row.left - slack),
    );
    if (!truncated && !overflowsParent) continue;
    clipped.push({
      text,
      tag: control.tagName.toLowerCase(),
      role: control.getAttribute('role'),
      truncated: truncated ? { scrollWidth: truncated.scrollWidth, clientWidth: truncated.clientWidth } : null,
      overflowsParent: overflowsParent
        ? {
            px: Math.round(Math.max(own.right - row.right, row.left - own.left)),
            parent: `${parent.tagName.toLowerCase()}.${[...parent.classList].slice(0, 6).join('.')}`,
          }
        : null,
    });
  }

  // English leftovers: the visible text of each element (its own text nodes)
  // that is an English catalog value but not this locale's value for that key.
  const allowed = new Set([...doNotTranslate, ...fixtureTexts]);
  const pattern = (template) =>
    new RegExp(
      `^${template
        .replace(/\{[^{}]+\}/g, '\u0000')
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replaceAll('\u0000', '.+?')}$`,
      's',
    );
  const exact = new Map();
  const shaped = [];
  for (const [key, texts] of Object.entries(english))
    for (const template of texts) {
      const text = normal(template);
      if (/\{[^{}]+\}/.test(text)) {
        if (letters(text.replace(/\{[^{}]+\}/g, '')) >= 3) shaped.push({ key, test: pattern(text) });
      } else if (letters(text) >= 3) exact.set(text, [...(exact.get(text) ?? []), key]);
    }
  // The locale's own translations: its texts that differ from English for the
  // same key. A key whose text is a copy of the English one is untranslated.
  const translated = new Map(
    Object.entries(local).map(([key, texts]) => [
      key,
      (sameKeys.includes(key) ? texts : texts.filter((text) => !(english[key] ?? []).includes(text))).map(normal),
    ]),
  );
  const isOwn = (key, text) => (translated.get(key) ?? []).some((value) => value === text || (/\{[^{}]+\}/.test(value) && pattern(value).test(text)));
  const leftovers = [];
  const seen = new Set();
  for (const element of base ? [] : container.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'svg', 'TITLE'].includes(element.tagName) || !visible(element)) continue;
    const own = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent);
    const text = normal(own.join(''));
    if (letters(text) < 3 || allowed.has(text)) continue;
    // The English keys this text could be. It is the locale's own only through
    // one of those keys; that another key happens to translate to the same
    // text (German "Name" for "Name (or Host)") doesn't make it translated.
    const keys = [...(exact.get(text) ?? []), ...shaped.filter((entry) => entry.test.test(text)).map((entry) => entry.key)];
    if (keys.length === 0 || keys.some((key) => isOwn(key, text))) continue;
    const alsoTranslationOf = [...translated].filter(([key]) => !keys.includes(key) && isOwn(key, text)).map(([key]) => key);
    leftovers.push({
      text,
      keys: keys.slice(0, 3),
      tag: element.tagName.toLowerCase(),
      ...(alsoTranslationOf.length ? { ambiguous: `also this locale's text for ${alsoTranslationOf.slice(0, 3).join(', ')}` } : {}),
    });
    seen.add(text);
  }
  return {
    htmlLang: document.documentElement.lang,
    htmlDir: document.documentElement.dir,
    overflow: { scrollWidth: document.documentElement.scrollWidth, innerWidth },
    clipped,
    leftovers: { count: leftovers.length, unique: seen.size, first: leftovers.slice(0, 20) },
  };
}

const lock = await acquireDevstackLock(`dash-locale-screens (${locales.join(',')})\n${root}`);
let browser;
let harness;
try {
  harness = await mkdtemp(resolve(appDir, '.dash-locale-screens-capture-'));
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dashboard locale screens</title></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>',
  );
  await writeFile(resolve(harness, 'main.tsx'), "import './styles.css';\nimport '../scripts/dash-locale-screens.fixture.tsx';\n");
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@import "../src/content-blocks.css";\n@source "../src";\n@source "../scripts/dash-locale-screens.fixture.tsx";\n',
  );
  const dist = resolve(harness, 'dist');
  const { build } = await fromApp('vite');
  await build({
    configFile: false,
    root: harness,
    base: '/',
    logLevel: 'error',
    define: { 'import.meta.env.VITE_SITE_BASE_DOMAIN': JSON.stringify('docs.example.test') },
    resolve: { alias: { '@': resolve(appDir, 'src') } },
    plugins: [
      (await fromApp('@vitejs/plugin-react')).default(),
      (await fromApp('@tailwindcss/vite')).default(),
      {
        name: 'dash-locale-screens',
        enforce: 'pre',
        resolveId(source) {
          if (source.startsWith('@nibleaf/')) return appRequire.resolve(source);
        },
        load(file) {
          const path = file.replaceAll('\\', '/');
          // Plain Vite has no Start import-protection transform: use the browser halves.
          if (path.endsWith('/src/services/api-origin.ts')) return 'export const apiOrigin = () => window.location.origin;';
          if (path.endsWith('/src/lib/site-origin.ts')) return 'export const customDomainOrigin = () => undefined;';
          if (path.endsWith('/src/functions/site-search.ts'))
            return 'export const searchSiteFn = () => { throw new Error("Reader search is outside this dashboard fixture"); };';
        },
      },
    ],
    build: { outDir: dist, emptyOutDir: true, target: 'esnext', minify: !process.env.DEBUG_CAPTURE },
  });

  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser: guarded, attempted }) => {
    browser = guarded;
    const captures = [];
    let axeVersion = null;
    const only = process.env.ONLY?.split(',');
    const selectedScreens = screens.filter((item) => !only || only.includes(item.key));
    for (const locale of locales)
      for (const screen of selectedScreens)
        for (const size of sizes) {
          const name = `${screen.key}-${locale}-${size.width}`;
          const context = await browser.newContext({
            viewport: { width: size.width, height: size.height },
            isMobile: size.mobile,
            hasTouch: size.mobile,
            reducedMotion: 'reduce',
            colorScheme: 'light',
            locale,
            // Fixed, so dates and "Times shown in …" never show this machine's zone.
            timezoneId: 'UTC',
          });
          const page = await context.newPage();
          const pageErrors = [];
          page.on('pageerror', (error) => pageErrors.push(error.message));
          const consoleErrors = [];
          page.on('console', (message) => {
            if (message.type() === 'error') consoleErrors.push(message.text().slice(0, process.env.DEBUG_CAPTURE ? 3000 : 400));
          });
          const requests = [];
          const unexpected = [];
          await page.route(`${origin}/**`, async (route) => {
            const request = route.request();
            const { pathname } = new URL(request.url());
            if (pathname.startsWith('/api/')) {
              requests.push(`${request.method()} ${pathname}`);
              const result = request.method() === 'GET' || pathname === '/api/auth/get-session' ? answer(pathname) : null;
              if (result) return route.fulfill({ status: result.status ?? 200, json: result.json });
              // Not part of these screens: an empty answer, listed in the evidence.
              unexpected.push(`${request.method()} ${pathname}`);
              return route.fulfill({ json: { data: [] } });
            }
            const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
            assert.ok(file.startsWith(`${dist}${sep}`));
            return route.fulfill({
              body: await readFile(file),
              contentType:
                { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }[
                  extname(file)
                ] ?? 'application/octet-stream',
            });
          });
          const separator = screen.path.includes('?') ? '&' : '?';
          await page.goto(`${origin}${screen.path}${separator}locale=${locale}`);
          let scope = null;
          try {
            await page.waitForFunction(
              (siteName) => document.querySelector('header')?.textContent?.includes(siteName) || location.pathname.includes('/o/'),
              handbook.name,
              {
                timeout: 20_000,
              },
            );
            if (screen.key === 'settings')
              await page.waitForFunction(
                (siteName) => [...document.querySelectorAll('input')].some((input) => input.value === siteName),
                handbook.name,
                {
                  timeout: 20_000,
                },
              );
            if (screen.key === 'people') await page.getByText(orgMembers[3].user.email).first().waitFor({ timeout: 20_000 });
            if (screen.key === 'analytics' || screen.key === 'publish')
              await page.locator('[data-insights-region] figure[role="img"] .recharts-surface').first().waitFor({ timeout: 20_000 });
            if (screen.publish) {
              const publishName = plain(catalogs[locale], 'project_publish') ?? plain(english, 'project_publish');
              const control = page.locator('header').getByRole('button', { name: publishName, exact: true });
              await control.first().waitFor({ timeout: 20_000 });
              await page.waitForFunction((button) => !button.disabled, await control.first().elementHandle(), { timeout: 20_000 });
              await control.first().click();
              scope = '[role="dialog"]';
              await page.locator(scope).getByText(pendingChanges.checks[0].detail).first().waitFor({ timeout: 20_000 });
            }
          } catch (error) {
            await page.screenshot({ path: resolve(tmpdir(), `dash-locale-screens-${name}-failed.png`) }).catch(() => undefined);
            const shown = await page.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => '');
            throw new Error(`${name}: ${error.message}
Shown: ${shown}
Page errors: ${pageErrors.join(' | ')}
Console errors: ${consoleErrors.join(' | ')}
Requests: ${requests.join(', ')}`);
          }
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(600);
          const file = `${name}.png`;
          await page.screenshot({ path: resolve(output, file), animations: 'disabled', fullPage: !screen.publish });
          // English is the source: it has no leftovers by definition.
          const found = await page.evaluate(inspect, {
            scope,
            base: locale === 'en',
            english,
            local: catalogs[locale],
            doNotTranslate,
            fixtureTexts,
            sameKeys: await sameAsEnglish(locale),
          });
          const entry = {
            screen: screen.key,
            locale,
            width: size.width,
            file,
            htmlLang: found.htmlLang,
            htmlDir: found.htmlDir,
            pageErrors,
            consoleErrors,
            horizontalOverflow: found.overflow.scrollWidth > found.overflow.innerWidth,
            overflow: found.overflow,
            clipped: found.clipped,
            leftovers: found.leftovers,
            unexpectedRequests: [...new Set(unexpected)],
          };
          if (axeSource) {
            await page.addScriptTag({ content: axeSource });
            const result = await page.evaluate(
              (include) =>
                window.axe.run(include ?? document, { runOnly: { type: 'rule', values: ['color-contrast'] }, resultTypes: ['violations'] }),
              scope,
            );
            axeVersion = result.testEngine.version;
            entry.axeColorContrast = result.violations.flatMap((violation) =>
              violation.nodes.slice(0, 6).map((node) => ({ target: node.target.join(' '), summary: node.any?.[0]?.message ?? violation.help })),
            );
            entry.axeColorContrastNodes = result.violations.reduce((total, violation) => total + violation.nodes.length, 0);
          }
          captures.push(entry);
          await context.close();
          console.log(
            `${name}: leftovers ${entry.leftovers.count}, clipped ${entry.clipped.length}, dir ${entry.htmlDir}${entry.pageErrors.length ? `, page errors ${entry.pageErrors.length}` : ''}`,
          );
        }

    const summary = Object.fromEntries(
      locales.map((locale) => {
        const mine = captures.filter((entry) => entry.locale === locale);
        return [
          locale,
          {
            leftovers: mine.reduce((total, entry) => total + entry.leftovers.count, 0),
            clipped: mine.reduce((total, entry) => total + entry.clipped.length, 0),
            pageErrors: mine.reduce((total, entry) => total + entry.pageErrors.length, 0),
            horizontalOverflow: mine.filter((entry) => entry.horizontalOverflow).map((entry) => entry.file),
            ...(axeSource ? { axeColorContrastNodes: mine.reduce((total, entry) => total + entry.axeColorContrastNodes, 0) } : {}),
          },
        ];
      }),
    );
    await writeFile(
      resolve(output, 'evidence.json'),
      `${JSON.stringify(
        {
          environment:
            'Isolated actual-route fixture (dashboard shell, ProjectLayout + settings and analytics routes, OrganizationLayout + members route); intercepted fictional HTTP; no server, database or real site',
          locales,
          screens: selectedScreens.map((screen) => screen.key),
          sizes: sizes.map(({ width, height, mobile }) => `${width}×${height}${mobile ? ' touch' : ''}`),
          attempted: attempted.length,
          axe: axeSource ? { version: axeVersion, rules: ['color-contrast'] } : null,
          leftoverRule:
            'Visible text (an element’s own text nodes, ≥3 letters) equal to an en catalog value ({placeholders} match anything) that is not one of the locale’s own translations (its text for a key where it differs from English). A key whose locale text copies the English one counts as untranslated. Glossary doNotTranslate values and the keys untranslated/<locale>.json lists as sameAsEnglish are excluded; en has none by definition.',
          doNotTranslate: doNotTranslate.length,
          summary,
          captures,
        },
        null,
        2,
      )}\n`,
    );
    console.log(JSON.stringify({ attempted: attempted.length, summary }, null, 2));
    assert.equal(attempted.length, 0, 'no request outside the fixture origin');
    for (const entry of captures) {
      assert.deepEqual(entry.pageErrors, [], `${entry.file}: page errors`);
      assert.equal(entry.htmlLang, entry.locale, `${entry.file}: <html lang>`);
      assert.equal(entry.htmlDir, RTL.has(entry.locale) ? 'rtl' : 'ltr', `${entry.file}: <html dir>`);
    }
  });
} finally {
  await browser?.close();
  if (harness) {
    assert.ok(harness.startsWith(`${appDir}${sep}`));
    await rm(harness, { recursive: true, force: true });
  }
  await lock.release();
}
