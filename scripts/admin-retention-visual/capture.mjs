// Disposable rehearsal: renders the real admin build against mocked API responses.
// Every value below is an obvious placeholder. No database or real API is involved.
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.BROWSER_MODULE);
const base = 'http://localhost:4315';
const out = 'output/admin-retention';
await mkdir(out, { recursive: true });

const catalogs = {
  en: JSON.parse(await readFile('packages/i18n/messages/en.json', 'utf8')),
  ar: JSON.parse(await readFile('packages/i18n/messages/ar.json', 'utf8')),
};
const localeTag = { en: 'en', ar: 'ar-u-nu-latn' };
const viewports = { desktop: { width: 1280, height: 900 }, mobile: { width: 390, height: 844 } };
const observationStart = '2030-01-01T00:00:00.000Z';
const computedAt = '2030-03-15T21:45:00.000Z';
const states = {
  unknown: { firstManualPublishes: null, cohortSize: null, retained: null, rate: null, observationStart: null, computedAt },
  small: { firstManualPublishes: 3, cohortSize: 4, retained: 1, rate: null, observationStart, computedAt },
  known: { firstManualPublishes: 12345, cohortSize: 9876, retained: 1234, rate: 1234 / 9876, observationStart, computedAt },
};
const overview = {
  users: 1000,
  admins: 2,
  sites: 1000,
  deployments: 1000,
  publishedDeployments: 900,
  recentUsers: 10,
  verifiedUsers: 900,
  suspendedUsers: 0,
  failedDeployments24h: 0,
  activeDeployments: 0,
  domains: 10,
  healthyDomains: 10,
  domainIssues: 0,
  takenDownSites: 0,
  expiredOwnerInvites: 0,
  failedExports7d: 0,
  gitIssues: 0,
};
const funnel = (publishRetention) => ({
  days: 30,
  signups: 1000,
  edited: 800,
  published: 600,
  ready: 400,
  readyWithin24Hours: 200,
  medianHoursToReady: 6.5,
  sourceJourneys: [],
  publishRetention,
});
const session = {
  session: { id: 'synthetic-session', userId: 'synthetic-admin', expiresAt: '2099-01-01T00:00:00.000Z', createdAt: observationStart, updatedAt: observationStart },
  user: { id: 'synthetic-admin', name: 'Synthetic Admin', email: 'admin@example.invalid', emailVerified: true, createdAt: observationStart, updatedAt: observationStart },
};

let available = false;
for (let attempt = 0; attempt < 90 && !available; attempt++) {
  try {
    available = (await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) })).ok;
  } catch {}
  if (!available) await new Promise((resolve) => setTimeout(resolve, 1000));
}
if (!available) throw new Error('admin app did not start');

const browser = await chromium.launch();
const results = [];

/** Runs in the page, so number and date expectations use the browser's own ICU data. */
function measure(root, { locale, tag, retention, copy }) {
  const issues = [];
  const html = document.documentElement;
  if (html.lang !== locale) issues.push(`html lang is ${html.lang}`);
  if (html.dir !== (locale === 'ar' ? 'rtl' : 'ltr')) issues.push(`html dir is ${html.dir}`);
  if (getComputedStyle(root).direction !== html.dir) issues.push(`section direction is ${getComputedStyle(root).direction}`);
  if (html.scrollWidth > html.clientWidth) issues.push(`page overflows by ${html.scrollWidth - html.clientWidth}px`);

  const card = root.closest('[data-slot="card"]');
  if (!card) issues.push('card not found');
  const bounds = (card ?? root).getBoundingClientRect();
  for (const element of root.querySelectorAll('*')) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const label = `${element.tagName.toLowerCase()} "${element.textContent.slice(0, 40)}"`;
    if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1) issues.push(`${label} leaves the card`);
    if (element.scrollWidth > element.clientWidth + 1 && style.display !== 'inline') issues.push(`${label} overflows inline`);
    if (element.scrollHeight > element.clientHeight + 1 && style.overflowY !== 'visible') issues.push(`${label} is clipped`);
    if (style.textOverflow === 'ellipsis' || style.webkitLineClamp !== 'none') issues.push(`${label} truncates`);
  }

  const number = new Intl.NumberFormat(tag);
  const percent = new Intl.NumberFormat(tag, { style: 'percent', maximumFractionDigits: 0 });
  const unknown = copy.admin_overview_retentionunknown;
  const count = (value) => (value === null ? unknown : number.format(value));
  const expected = [
    count(retention.firstManualPublishes),
    count(retention.cohortSize),
    count(retention.retained),
    retention.rate === null ? unknown : percent.format(retention.rate),
  ];
  const values = [...root.querySelectorAll('.text-2xl')].map((element) => element.textContent);
  if (JSON.stringify(values) !== JSON.stringify(expected)) issues.push(`values ${JSON.stringify(values)} expected ${JSON.stringify(expected)}`);

  const text = root.textContent;
  if (/[٠-٩۰-۹]/.test(text)) issues.push('non-Latin digits rendered');
  const dateTime = new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(retention.computedAt));
  const required = [
    copy.admin_overview_publishretention,
    copy.admin_overview_firstmanualpublishes,
    copy.admin_overview_firstmanualpublisheshelp,
    copy.admin_overview_retentioncohort,
    copy.admin_overview_retentioncohorthelp,
    copy.admin_overview_retentionrate,
    copy.admin_overview_retentionretained,
    copy.admin_overview_retentionretainedhelp,
    copy.admin_overview_retentionupdated.replace('{time}', dateTime),
  ];
  if (retention.observationStart) {
    const date = new Intl.DateTimeFormat(tag, { dateStyle: 'medium' }).format(new Date(retention.observationStart));
    required.push(copy.admin_overview_retentioncoverage.replace('{date}', date));
  }
  if (retention.cohortSize !== null && retention.rate === null) required.push(copy.admin_overview_retentionsmallgroup);
  for (const value of required) if (!text.includes(value)) issues.push(`missing text: ${value}`);

  return { issues, values, card: { y: bounds.top + window.scrollY, height: bounds.height } };
}

async function capture(locale, device, state) {
  const context = await browser.newContext({ viewport: viewports[device], locale, timezoneId: 'UTC', colorScheme: 'light', deviceScaleFactor: 2 });
  await context.addCookies([{ name: 'NIBLEAF_LOCALE', value: locale, url: base }]);
  const problems = [];
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'localhost') return route.abort();
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (url.pathname === '/api/auth/get-session') return route.fulfill({ json: session });
    if (url.pathname === '/api/admin/overview') return route.fulfill({ json: { data: overview } });
    if (url.pathname === '/api/admin/funnel') return route.fulfill({ json: { data: funnel(states[state]) } });
    if (url.pathname === '/api/admin/users' || url.pathname === '/api/admin/sites') return route.fulfill({ json: { data: [] } });
    problems.push(`unmocked request ${url.pathname}`);
    return route.fulfill({ status: 404, json: {} });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
  });

  const name = `${locale}-${device}-${state}`;
  try {
    await page.goto(base, { waitUntil: 'networkidle' });
    const copy = catalogs[locale];
    const heading = page.getByRole('heading', { name: copy.admin_overview_publishretention, exact: true });
    await heading.waitFor();
    const section = page.locator('section').filter({ has: heading });
    await page.evaluate(() => document.fonts.ready);

    const measured = await section.evaluate(measure, { locale, tag: localeTag[locale], retention: states[state], copy });
    problems.push(...measured.issues);
    await page.screenshot({
      path: `${out}/${name}.png`,
      fullPage: true,
      clip: { x: 0, y: measured.card.y, width: viewports[device].width, height: measured.card.height },
    });
    results.push({ name, locale, device, state, values: measured.values, problems });
  } catch (error) {
    await page.screenshot({ path: `${out}/${name}-failed.png`, fullPage: true }).catch(() => undefined);
    results.push({ name, locale, device, state, problems: [...problems, `capture failed: ${error.message}`] });
  }
  await context.close();
}

for (const locale of ['en', 'ar']) {
  for (const device of ['desktop', 'mobile']) {
    for (const state of ['unknown', 'small', 'known']) await capture(locale, device, state);
  }
}
await browser.close();
await writeFile(`${out}/report.json`, `${JSON.stringify(results, null, 2)}\n`);
for (const { name, problems } of results) {
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name}${problems.map((problem) => `\n     ${problem}`).join('')}`);
}
if (results.length !== 12 || results.some(({ problems }) => problems.length)) process.exitCode = 1;
