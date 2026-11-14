// Unknown organizations and websites inside the app shell, and the plain-words
// "reports are off" notice (#651): before and after, EN/AR, 1440/390,
// light/dark. The actual routes, layouts and analytics sections, with
// fictional API answers served by request interception. No server, port,
// database or real site is used.
//
// axe-core is read from AXE_CORE (a path to axe.min.js) or resolved from the
// repo root; its version is recorded in the evidence. ONLY=<screen key>[,…]
// narrows a debugging run, and DEBUG_CAPTURE=1 builds unminified with full
// console stacks.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireDevstackLock, hostKey, withLocalOnlyBrowser } from '../lib/capture-env.mjs';

const root = resolve(import.meta.dirname, '../../..');
const appDir = resolve(root, 'apps/app');
const appRequire = createRequire(resolve(appDir, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(appRequire.resolve(name)).href);
const output = resolve(root, '.github/assets/dash-unknown-shell');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const baseline = process.env.BASELINE ?? git('merge-base', 'HEAD', 'origin/main').trim();
const axeSource = await readFile(process.env.AXE_CORE ?? createRequire(resolve(root, 'package.json')).resolve('axe-core/axe.min.js'), 'utf8');
// Never listened on: every request to it is answered by page.route below.
const origin = 'http://fixture.nibleaf.test';
const AXE_RULES = ['landmark-one-main', 'region', 'role-img-alt', 'svg-img-alt', 'color-contrast', 'button-name', 'link-name'];

// "Before" = the baseline source of every app file this branch changed (that existed then).
const changedFiles = git('diff', '--name-only', baseline, 'HEAD', '--', 'apps/app/src')
  .split('\n')
  .filter((file) => file && !/\.test\.tsx?$/.test(file))
  .filter((file) => git('ls-tree', '--name-only', baseline, '--', file).trim() === file);
const beforeSources = new Map(changedFiles.map((file) => [file, git('show', `${baseline}:${file}`)]));
// Paraglide compiles the catalogs into one module per message: put the baseline
// EN/AR text back into the modules of the messages this branch changed.
const catalogs = Object.fromEntries(
  ['en', 'ar'].map((locale) => {
    const file = `packages/i18n/messages/${locale}.json`;
    return [locale, { before: JSON.parse(git('show', `${baseline}:${file}`)), after: JSON.parse(git('show', `HEAD:${file}`)) }];
  }),
);
const changedMessages = Object.keys(catalogs.en.after).filter((key) =>
  ['en', 'ar'].some(
    (locale) =>
      catalogs[locale].before[key] !== undefined && JSON.stringify(catalogs[locale].before[key]) !== JSON.stringify(catalogs[locale].after[key]),
  ),
);
const beforeMessage = (key, source) => {
  let patched = source;
  for (const locale of ['en', 'ar']) {
    const { before, after } = catalogs[locale];
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    const from = `(${JSON.stringify(after[key])})`;
    assert.ok(patched.includes(from), `${key}: compiled ${locale} text matches the catalog`);
    patched = patched.replace(from, `(${JSON.stringify(before[key])})`);
  }
  return patched;
};

const date = '2026-11-12T00:00:00.000Z';
const fresh = new Date(Date.now() - 5 * 60_000).toISOString();
const series = (values) => values.map((value, index) => ({ bucket: `2026-11-${String(index + 1).padStart(2, '0')}`, value }));
const meta = (availability) => ({
  availability,
  timezone: 'UTC',
  current: { from: '2026-10-14T00:00:00.000Z', to: '2026-11-13T00:00:00.000Z' },
  previous: { from: '2026-09-14T00:00:00.000Z', to: '2026-10-14T00:00:00.000Z' },
  granularity: 'day',
  generatedAt: date,
  lastEventAt: availability === 'reads_disabled' ? undefined : fresh,
});
const unknownKpi = { value: null, previous: null };
const vitals = (overrides = {}) => ({
  samples: 1840,
  lcpP75Ms: 2100,
  inpP75Ms: 180,
  clsP75: 0.06,
  fcpP75Ms: 900,
  ttfbP75Ms: 320,
  rating: { good: 0.68, needsImprovement: 0.22, poor: 0.1 },
  ...overrides,
});

/** Fictional API answers for one capture; `scenario` picks the state. */
function fixture(locale, scenario) {
  const ar = locale === 'ar';
  const acme = { id: 'org-acme', slug: 'acme', name: ar ? 'أكمي' : 'Acme Docs', logo: null, orgRole: 'owner', canCreateWebsite: true };
  const handbook = {
    id: 'handbook',
    organizationId: acme.id,
    name: ar ? 'دليل الفريق' : 'Team handbook',
    slug: 'team-handbook',
    description: null,
    icon: null,
    config: {},
    languages: [],
    createdAt: date,
    updatedAt: date,
    readyPublishes: 3,
    hasPublishedVersion: true,
    role: 'owner',
    domain: null,
  };
  const pageViews = [120, 134, 98, 160, 172, 150, 188, 201, 176, 195, 220, 240, 210, 236];
  const overview = (availability) => ({
    meta: meta(availability),
    kpis:
      availability === 'reads_disabled'
        ? Object.fromEntries(
            [
              'pageViews',
              'visits',
              'avgEngagedMs',
              'avgScrollDepth',
              'searches',
              'searchSuccessRate',
              'zeroResultRate',
              'helpfulRate',
              'aiAssistantVisits',
              'aiCrawlerRequests',
            ].map((key) => [key, unknownKpi]),
          )
        : {
            pageViews: { value: 2500, previous: 2100 },
            visits: { value: 910, previous: 840 },
            avgEngagedMs: { value: 95_000, previous: 80_000 },
            avgScrollDepth: { value: 0.62, previous: 0.6 },
            searches: { value: 300, previous: 250 },
            searchSuccessRate: { value: 0.7, previous: 0.72 },
            zeroResultRate: { value: 0.12, previous: 0.08 },
            helpfulRate: { value: 0.81, previous: 0.78 },
            aiAssistantVisits: { value: 37, previous: 20 },
            aiCrawlerRequests: { value: 900, previous: 610 },
          },
    pageViewsSeries: availability === 'reads_disabled' ? [] : series(pageViews),
    previousPageViewsSeries: availability === 'reads_disabled' ? [] : series(pageViews.map((value) => Math.round(value * 0.8))),
    topPages: [],
    pagesNeedingWork: [],
    failedSearches: [],
    searchTermsVisibility: 'visible',
    channels: [],
    feedback: { helpful: 0, notHelpful: 0 },
  });
  const performance = {
    meta: meta('complete'),
    overall: vitals(),
    byDevice: [
      { device: 'desktop', ...vitals({ lcpP75Ms: 1700 }) },
      { device: 'mobile', ...vitals({ lcpP75Ms: 3100, rating: { good: 0.52, needsImprovement: 0.3, poor: 0.18 } }) },
    ],
    slowestPages: [{ path: 'api/reference', title: ar ? 'مرجع الواجهة' : 'API reference', ...vitals({ lcpP75Ms: 4100 }) }],
    lcpP75Series: series([2300, 2250, 2400, 2180, 2120, 2050, 1990, 2100, 2060, 2010, 1980, 2040, 1960, 1930]),
  };
  const switcher = {
    organizations: [{ ...acme, websiteCount: 1 }],
    recent: [],
    landing: { id: acme.id, slug: acme.slug },
  };
  /** The JSON answer for an API path; `null` = not part of this fixture. */
  return (pathname) => {
    if (pathname === '/api/auth/get-session')
      return {
        json: {
          session: { id: 'fixture', userId: 'owner', expiresAt: '2099-01-01T00:00:00.000Z' },
          user: {
            id: 'owner',
            name: ar ? 'مالكة الموقع' : 'Site owner',
            email: 'owner@example.test',
            emailVerified: true,
            createdAt: date,
            updatedAt: date,
          },
        },
      };
    const notFound = { status: 404, json: { error: { code: 'NOT_FOUND', message: 'Not found' } } };
    if (pathname === '/api/app/me/switcher') return { json: { data: switcher } };
    if (pathname === '/api/app/organizations/by-slug/unknown') return notFound;
    if (pathname === '/api/app/organizations/by-slug/acme') return { json: { data: acme } };
    if (pathname.startsWith('/api/app/projects/unknown')) return scenario === 'siteNetwork' ? 'abort' : notFound;
    if (pathname === '/api/app/projects') return { json: { data: [handbook] } };
    if (pathname === '/api/app/projects/handbook') return { json: { data: handbook } };
    if (pathname === '/api/app/notifications/unread-count') return { json: { data: { count: 0 } } };
    // The website shell (sidebar, publish control): an owner, one version, nothing waiting to publish.
    const site = '/api/app/projects/handbook';
    if (pathname === `${site}/members`)
      return {
        json: {
          data: {
            members: [{ id: 'member', role: 'owner', user: { id: 'owner', name: 'Site owner', email: 'owner@example.test' } }],
            invitations: [],
          },
        },
      };
    if (pathname === `${site}/branches`)
      return {
        json: { data: [{ id: 'main', projectId: handbook.id, name: 'main', isDefault: true, forkedAt: null, createdAt: date, updatedAt: date }] },
      };
    if (pathname === `${site}/deployments/changes`)
      return {
        json: {
          data: {
            hasRealContent: true,
            hasBaseline: true,
            upToDate: true,
            changes: [],
            checks: [],
            redirectIssues: [],
            reviewedStateHash: 'fixture',
          },
        },
      };
    if ([`${site}/languages`, `${site}/pages`, `${site}/deployments`, `${site}/domains`].includes(pathname)) return { json: { data: [] } };
    if (pathname === '/api/app/projects/handbook/analytics/insights/overview')
      return { json: { data: overview(scenario === 'readsDisabled' ? 'reads_disabled' : 'complete') } };
    if (pathname === '/api/app/projects/handbook/analytics/insights/performance') return { json: { data: performance } };
    return null;
  };
}

const screens = [
  { key: 'unknown-org', path: '/app/o/unknown/websites', phases: ['before', 'after'], scenario: 'org404', problem: true },
  { key: 'unknown-site', path: '/app/projects/unknown', phases: ['before', 'after'], scenario: 'site404', problem: true },
  { key: 'site-load-failed', path: '/app/projects/unknown', phases: ['after'], scenario: 'siteNetwork', problem: true },
  { key: 'analytics-reads-off', path: '/app/projects/handbook/analytics', phases: ['before', 'after'], scenario: 'readsDisabled' },
  { key: 'analytics-charts', path: '/app/projects/handbook/analytics/performance', phases: ['after'], scenario: 'charts' },
];

const lock = await acquireDevstackLock(`fix/analytics-charts-a11y (dash-unknown-shell)\n${root}`);
let browser;
let harness;
try {
  harness = await mkdtemp(resolve(appDir, '.dash-unknown-shell-capture-'));
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unknown pages in the app shell</title></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>',
  );
  await writeFile(resolve(harness, 'main.tsx'), "import './styles.css';\nimport '../scripts/dash-unknown-shell.fixture.tsx';\n");
  // Tailwind scans the baseline sources too, so their classes exist in the "before" CSS.
  const sourceLines = [];
  for (const [index, source] of [...beforeSources.values()].entries()) {
    await writeFile(resolve(harness, `before-${index}.tsx`), source);
    sourceLines.push(`@source "./before-${index}.tsx";`);
  }
  await writeFile(
    resolve(harness, 'styles.css'),
    `@import "@nibleaf/design-system/globals.css";\n@import "../src/content-blocks.css";\n@source "../src";\n${sourceLines.join('\n')}\n@source "../scripts/dash-unknown-shell.fixture.tsx";\n`,
  );
  const { build } = await fromApp('vite');
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser: guarded, attempted }) => {
    browser = guarded;
    const evidence = [];
    let axeVersion = null;
    for (const phase of ['before', 'after']) {
      const dist = resolve(harness, phase);
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
            name: 'dash-unknown-shell',
            enforce: 'pre',
            resolveId(source) {
              if (source.startsWith('@nibleaf/')) return appRequire.resolve(source);
            },
            async load(file) {
              const path = file.replaceAll('\\', '/');
              // Plain Vite has no Start import-protection transform: use the browser halves.
              if (path.endsWith('/src/services/api-origin.ts')) return 'export const apiOrigin = () => window.location.origin;';
              if (path.endsWith('/src/lib/site-origin.ts')) return 'export const customDomainOrigin = () => undefined;';
              if (path.endsWith('/src/functions/site-search.ts'))
                return 'export const searchSiteFn = () => { throw new Error("Reader search is outside this dashboard fixture"); };';
              if (phase !== 'before') return;
              for (const [changed, source] of beforeSources) if (path.endsWith(`/${changed}`)) return source;
              const message = changedMessages.find((key) => path.endsWith(`/paraglide/messages/${key}.js`));
              if (message) return beforeMessage(message, await readFile(file, 'utf8'));
            },
          },
        ],
        build: { outDir: dist, emptyOutDir: true, target: 'esnext', minify: !process.env.DEBUG_CAPTURE },
      });
      // ONLY=<screen key>[,…] narrows a debugging run (the evidence then covers only those).
      const only = process.env.ONLY?.split(',');
      for (const screen of screens.filter((item) => item.phases.includes(phase) && (!only || only.includes(item.key))))
        for (const locale of ['en', 'ar'])
          for (const width of [1440, 390])
            for (const theme of ['light', 'dark']) {
              const catalog = catalogs[locale][phase];
              const context = await browser.newContext({
                viewport: { width, height: width === 390 ? 844 : 1000 },
                isMobile: width === 390,
                hasTouch: width === 390,
                reducedMotion: 'reduce',
                colorScheme: theme,
                // Fixed, so the filter bar's "Times shown in …" never shows this machine's zone.
                timezoneId: 'UTC',
              });
              const page = await context.newPage();
              const errors = [];
              page.on('pageerror', (error) => errors.push(error.message));
              const consoleErrors = [];
              page.on('console', (message) => {
                if (message.type() !== 'error') return;
                const stack = message
                  .args()[0]
                  ?.evaluate((value) => (value instanceof Error ? value.stack : null))
                  .catch(() => null);
                consoleErrors.push(
                  Promise.resolve(stack).then((trace) => (trace ?? message.text()).slice(0, process.env.DEBUG_CAPTURE ? 3000 : 400)),
                );
              });
              const answer = fixture(locale, screen.scenario);
              const requests = [];
              const unexpected = [];
              await page.route(`${origin}/**`, async (route) => {
                const request = route.request();
                const { pathname } = new URL(request.url());
                if (pathname.startsWith('/api/')) {
                  requests.push(`${request.method()} ${pathname}`);
                  const result = answer(pathname);
                  if (result === 'abort') return route.abort('internetdisconnected');
                  if (result) return route.fulfill({ status: result.status ?? 200, json: result.json });
                  // Not part of this screen: an empty answer, listed in the evidence.
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
              const name = `${phase}-${screen.key}-${locale}-${width}-${theme}`;
              await page.goto(`${origin}${screen.path}?locale=${locale}&theme=${theme}`);
              try {
                if (screen.key === 'unknown-org' || screen.key === 'unknown-site')
                  await page.getByRole('heading', { name: catalog.notfound_title, exact: true }).waitFor({ timeout: 20_000 });
                else if (screen.key === 'site-load-failed')
                  await page.getByRole('heading', { name: catalog.error_title, exact: true }).waitFor({ timeout: 20_000 });
                else if (screen.key === 'analytics-reads-off')
                  await page.getByRole('heading', { name: catalog.analytics_status_readsdisabled_title, exact: true }).waitFor({ timeout: 20_000 });
                else {
                  await page.locator('figure[role="img"] .recharts-surface').first().waitFor({ timeout: 20_000 });
                  await page.locator('[data-insights-region] dl').first().waitFor();
                }
              } catch (error) {
                consoleErrors.splice(0, consoleErrors.length, ...(await Promise.all(consoleErrors)));
                // Leave what the page showed next to the run, then fail.
                await page.screenshot({ path: resolve(tmpdir(), `dash-unknown-shell-${name}-failed.png`) }).catch(() => undefined);
                const shown = await page.evaluate(() => document.body.innerText.slice(0, 600)).catch(() => '');
                throw new Error(`${name}: ${error.message}
Shown: ${shown}
Page errors: ${errors.join(' | ')}
Console errors: ${consoleErrors.join(' | ')}
Requests: ${requests.join(', ')}`);
              }
              await page.evaluate(() => document.fonts.ready);
              await page.waitForTimeout(500);
              const file = `${name}.png`;
              await page.screenshot({ path: resolve(output, file), animations: 'disabled' });
              const overflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth }));
              consoleErrors.splice(0, consoleErrors.length, ...(await Promise.all(consoleErrors)));
              const entry = {
                phase,
                screen: screen.key,
                locale,
                width,
                theme,
                file,
                noHorizontalOverflow: overflow.scrollWidth <= overflow.innerWidth,
                overflow,
                pageErrors: errors,
                consoleErrors,
                requests,
                unexpectedRequests: unexpected,
              };
              if (screen.key === 'analytics-reads-off') {
                entry.notice = await page.evaluate(
                  (title) => [...document.querySelectorAll('h2')].find((h) => h.textContent === title)?.nextElementSibling?.textContent ?? null,
                  catalog.analytics_status_readsdisabled_title,
                );
                entry.mentionsAnalyticsMode = (await page.evaluate(() => document.body.innerText)).includes('ANALYTICS_MODE');
              }
              if (phase === 'after' && screen.problem) {
                entry.structure = await page.evaluate(() => {
                  const text = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
                  const accessibleName = (element) => {
                    const label = element.getAttribute('aria-label')?.trim();
                    if (label) return label;
                    const labelledBy = element.getAttribute('aria-labelledby');
                    if (labelledBy)
                      return labelledBy
                        .split(/\s+/)
                        .map((id) => text(document.getElementById(id)))
                        .join(' ')
                        .trim();
                    return text(element) || element.getAttribute('title')?.trim() || '';
                  };
                  const controls = [...document.querySelectorAll('button, a[href], [role="button"], [role="link"]')].filter(
                    (element) => !element.closest('[aria-hidden="true"]'),
                  );
                  return {
                    mainLandmarks: document.querySelectorAll('main, [role="main"]').length,
                    headings: [...document.querySelectorAll('h1, h2, [role="heading"]')].map(text),
                    header: text(document.querySelector('header')),
                    controls: controls.map((element) => ({
                      tag: element.tagName.toLowerCase(),
                      name: accessibleName(element),
                      href: element.getAttribute('href'),
                    })),
                    unnamedControls: controls.filter((element) => !accessibleName(element)).length,
                  };
                });
                entry.backToOrganization = entry.structure.controls.some((control) => control.href?.startsWith('/app/o/acme/websites'));
              }
              if (screen.key === 'analytics-charts') {
                const chartChecks = () =>
                  page.evaluate(() => {
                    const text = (element) => (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
                    const figures = [...document.querySelectorAll('figure[role="img"]')].map((figure) => {
                      const labelledBy = figure.getAttribute('aria-labelledby');
                      const name =
                        figure.getAttribute('aria-label')?.trim() ||
                        (labelledBy
                          ? labelledBy
                              .split(/\s+/)
                              .map((id) => text(document.getElementById(id)))
                              .join(' ')
                              .trim()
                          : '');
                      return { name };
                    });
                    // The Web Vitals rating bar: a hidden bar followed by its <dl> text alternative.
                    const vitals = [...document.querySelectorAll('[data-insights-region] dl')]
                      .filter((list) => list.querySelector('dt') && list.parentElement?.firstElementChild?.querySelector('.bg-success'))
                      .map((list) => {
                        const bar = list.parentElement.firstElementChild;
                        return {
                          barAriaHidden: bar.getAttribute('aria-hidden') === 'true',
                          items: [...list.querySelectorAll(':scope > div')].map(
                            (item) => `${text(item.querySelector('dt'))}: ${text(item.querySelector('dd'))}`,
                          ),
                        };
                      });
                    return { figures, vitals };
                  });
                entry.charts = { performance: await chartChecks() };
                // The analytics Overview's page-views trend: same check, no screenshot.
                await page.goto(`${origin}/app/projects/handbook/analytics?locale=${locale}&theme=${theme}`);
                await page.locator('[data-insights-region] figure[role="img"] .recharts-surface').first().waitFor({ timeout: 20_000 });
                entry.charts.overview = await chartChecks();
                await page.goto(`${origin}${screen.path}?locale=${locale}&theme=${theme}`);
                await page.locator('[data-insights-region] dl').first().waitFor({ timeout: 20_000 });
                entry.charts.allFiguresNamed = [...entry.charts.performance.figures, ...entry.charts.overview.figures].every(
                  (f) => f.name.length > 0,
                );
                entry.charts.vitalsBarHiddenWithDl =
                  entry.charts.performance.vitals.length > 0 &&
                  entry.charts.performance.vitals.every((v) => v.barAriaHidden && v.items.length === 3 && v.items.every((item) => /\d/.test(item)));
              }
              if (phase === 'after') {
                await page.addScriptTag({ content: axeSource });
                const result = await page.evaluate(
                  (rules) => window.axe.run(document, { runOnly: { type: 'rule', values: rules }, resultTypes: ['violations'] }),
                  AXE_RULES,
                );
                axeVersion = result.testEngine.version;
                entry.axe = result.violations.map((violation) => ({
                  rule: violation.id,
                  impact: violation.impact,
                  nodes: violation.nodes.length,
                  targets: violation.nodes.slice(0, 4).map((node) => node.target.join(' ')),
                  summary: violation.nodes[0]?.any?.[0]?.message ?? violation.help,
                }));
              }
              evidence.push(entry);
              await context.close();
              console.log(`${name}: captured${entry.axe?.length ? ` (axe: ${entry.axe.map((v) => `${v.rule}×${v.nodes}`).join(', ')})` : ''}`);
            }
    }
    await writeFile(
      resolve(output, 'evidence.json'),
      `${JSON.stringify(
        {
          baseline,
          head: git('rev-parse', 'HEAD').trim(),
          environment: 'Isolated actual-route fixture; intercepted fictional HTTP; no server, database or real site',
          swappedForBefore: [...beforeSources.keys(), ...changedMessages.map((key) => `paraglide message ${key} (en, ar)`)],
          attempted: attempted.length,
          axe: { version: axeVersion, rules: AXE_RULES },
          captures: evidence,
        },
        null,
        2,
      )}\n`,
    );
    assert.equal(attempted.length, 0, 'no request outside the fixture origin');
    for (const entry of evidence) {
      const name = `${entry.phase}-${entry.screen}-${entry.locale}-${entry.width}-${entry.theme}`;
      assert.ok(entry.noHorizontalOverflow, `${name}: no horizontal overflow (${JSON.stringify(entry.overflow)})`);
      assert.deepEqual(entry.pageErrors, [], `${name}: page errors`);
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
