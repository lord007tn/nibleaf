// Separate diagnostic, not one of rows 1–16: how often signed-in /app throws a
// hydration error on the merged branch and on origin/main. Both builds run on
// port 4310 against the same fixture, local API, database and session, and
// take turns in rounds so time since seeding is comparable.
//
// Two arms per load:
//   live     — the document streams from the server untouched; its body is read
//              from Playwright's response object after the load.
//   replayed — the document is fetched in full and replayed in one piece. This
//              was the first version of this diagnostic; it is kept to show
//              whether buffering the document changes the rate.
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const { chromium } = await import(process.env.BROWSER_MODULE);
const out = `${process.env.OUT ?? 'output/ui-browser'}/hydration`;
const APP = 'http://localhost:4310';
const ROUNDS = Number(process.env.ROUNDS ?? 4);
const PER_COMBO = Number(process.env.PER_COMBO ?? 10);
const REPLAYED_PER_COMBO = Number(process.env.REPLAYED_PER_COMBO ?? 3);
const BASELINES_PER_GROUP = 2;
const BUILDS = { merged: process.env.MERGED_SERVER, main: process.env.MAIN_SERVER };
const ARMS = ['live', 'replayed'];
const COMBOS = [
  { lang: 'en', width: 390 },
  { lang: 'en', width: 1440 },
  { lang: 'ar', width: 390 },
  { lang: 'ar', width: 1440 },
];
const HYDRATION = /Minified React error #(418|419|421|422|423|425)\b|hydrat|did not match|server rendered/i;
const DOCUMENT = /^http:\/\/localhost:4310\/app\/?(\?.*)?$/;
for (const dir of ['merged', 'main', 'baseline']) await mkdir(`${out}/${dir}`, { recursive: true });

const session = JSON.parse(await readFile(process.env.SESSION_FILE, 'utf8'));
const cookieHeader = session.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
const exists = async (path) => Boolean(path) && (await readFile(path).then(() => true, () => false));

let server = null;
const reachable = async () => {
  try {
    return (await fetch(`${APP}/app`, { headers: { cookie: cookieHeader }, redirect: 'manual', signal: AbortSignal.timeout(5000) })).status;
  } catch {
    return 0;
  }
};
async function start(build) {
  const log = openSync(`${out}/${build}-server.log`, 'a');
  const entry = resolve(BUILDS[build]);
  server = spawn(process.execPath, [entry], {
    cwd: resolve(dirname(entry), '../..'),
    env: { ...process.env, PORT: '4310', NODE_ENV: 'production' },
    stdio: ['ignore', log, log],
  });
  for (let attempt = 0; attempt < 90; attempt++) {
    if ((await reachable()) === 200) return true;
    await new Promise((done) => setTimeout(done, 1000));
  }
  return false;
}
async function stop() {
  if (!server) return;
  const exited = new Promise((done) => server.once('exit', done));
  server.kill('SIGTERM');
  await exited;
  server = null;
  while ((await reachable()) !== 0) await new Promise((done) => setTimeout(done, 250));
}

// Runs in the page before any app script. Records text mutations once parsing
// is done, and snapshots the DOM at the moment React reports a hydration error.
// Times are navigation-relative (performance.now()).
const INIT = () => {
  const textsOf = (root) => {
    const texts = [];
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement && !node.parentElement.closest('script,style,template,noscript') && node.nodeValue.trim()
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT,
    });
    while (walker.nextNode()) texts.push(walker.currentNode.nodeValue.trim());
    return texts;
  };
  window.__textsOf = textsOf;
  window.__mutations = [];
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const at = Math.round(performance.now());
      if (record.type === 'characterData') {
        window.__mutations.push({ at, kind: 'text', before: record.oldValue, after: record.target.nodeValue });
        continue;
      }
      for (const node of record.removedNodes) {
        const text = (node.textContent || '').trim();
        if (text) window.__mutations.push({ at, kind: 'removed', text: text.slice(0, 400) });
      }
      for (const node of record.addedNodes) {
        const text = (node.textContent || '').trim();
        if (text) window.__mutations.push({ at, kind: 'added', text: text.slice(0, 400) });
      }
    }
    if (window.__mutations.length > 600) observer.disconnect();
  });
  document.addEventListener('readystatechange', () => {
    if (document.readyState === 'interactive') {
      observer.observe(document, { subtree: true, childList: true, characterData: true, characterDataOldValue: true });
    }
  });
  window.addEventListener(
    'error',
    (event) => {
      if (window.__atError || !/#4(18|19|21|22|23|25)\b|ydrat/.test(String(event.message))) return;
      window.__atError = { at: Math.round(performance.now()), texts: textsOf(document.documentElement), html: document.documentElement.outerHTML };
    },
    true,
  );
};

const multisetDiff = (left, right) => {
  const counts = new Map();
  for (const text of right) counts.set(text, (counts.get(text) ?? 0) + 1);
  const only = [];
  for (const text of left) {
    const count = counts.get(text) ?? 0;
    if (count > 0) counts.set(text, count - 1);
    else only.push(text);
  }
  return only;
};

const browser = await chromium.launch();
const loads = [];
const baselinesSaved = new Map();
let seedTime = null;

async function load(build, combo, index, arm) {
  const mobile = combo.width === 390;
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: mobile,
    hasTouch: mobile,
    locale: combo.lang === 'ar' ? 'ar' : 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
  });
  await context.addCookies([{ name: 'NIBLEAF_LOCALE', value: combo.lang, url: APP }, ...session.cookies.map((cookie) => ({ ...cookie, url: APP }))]);
  await context.route('**/*', (route) => (['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.fallback() : route.abort()));
  let serverHtml = null;
  if (arm === 'replayed') {
    await context.route(DOCUMENT, async (route) => {
      if (route.request().resourceType() !== 'document') return route.fallback();
      const response = await route.fetch();
      serverHtml = await response.text();
      await route.fulfill({ response, body: serverHtml });
    });
  }
  await context.addInitScript(INIT);
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  const startedAt = Date.now();
  const record = { build, arm, lang: combo.lang, width: combo.width, index, at: new Date(startedAt).toISOString(), sinceSeedMs: seedTime ? startedAt - seedTime : null };
  try {
    const response = await page.goto(`${APP}/app`, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(2500);
    if (arm === 'live' && response) serverHtml = await response.text().catch(() => null);
  } catch (error) {
    record.navigationError = error.message.split('\n')[0];
  }
  record.finalUrl = page.url();
  // When the dashboard's data arrived, relative to navigation and to the error.
  record.timing = await page
    .evaluate(() => {
      const resources = performance.getEntriesByType('resource');
      const end = (pattern) => {
        const entry = resources.find((item) => pattern.test(new URL(item.name).pathname));
        return entry ? Math.round(entry.responseEnd) : null;
      };
      const scripts = resources.filter((item) => /\.m?js$/.test(new URL(item.name).pathname));
      const nav = performance.getEntriesByType('navigation')[0];
      return {
        documentEnd: nav ? Math.round(nav.responseEnd) : null,
        domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
        lastScriptEnd: scripts.length ? Math.round(Math.max(...scripts.map((item) => item.responseEnd))) : null,
        session: end(/\/api\/auth\/get-session$/),
        projects: end(/^\/api\/app\/projects$/),
        hydrationErrorAt: window.__atError?.at ?? null,
      };
    })
    .catch(() => null);
  const hydration = [...pageErrors, ...consoleErrors].filter((text) => HYDRATION.test(text));
  record.hydration = hydration.map((text) => text.slice(0, 400));
  record.otherPageErrors = pageErrors.filter((text) => !HYDRATION.test(text)).map((text) => text.slice(0, 300));
  const mutations = await page.evaluate(() => window.__mutations).catch(() => []);
  const group = `${build}-${arm}-${combo.lang}-${combo.width}`;
  if (hydration.length) {
    const tag = `${String(loads.length + 1).padStart(3, '0')}-${arm}-${combo.lang}-${combo.width}`;
    const atError = await page.evaluate(() => window.__atError ?? null).catch(() => null);
    const serverTexts = serverHtml ? await page.evaluate((html) => window.__textsOf(new DOMParser().parseFromString(html, 'text/html').documentElement), serverHtml) : [];
    const clientTexts = atError?.texts ?? (await page.evaluate(() => window.__textsOf(document.documentElement)));
    record.serverOnlyText = multisetDiff(serverTexts, clientTexts);
    record.clientOnlyText = multisetDiff(clientTexts, serverTexts);
    // Text the server rendered that React removed, and what it put in its place.
    record.removedByClient = mutations.filter((item) => item.kind === 'removed').map((item) => item.text);
    record.addedByClient = mutations.filter((item) => item.kind === 'added').map((item) => item.text);
    record.files = {
      server: `${out}/${build}/${tag}-server.html`,
      client: `${out}/${build}/${tag}-client-at-error.html`,
      detail: `${out}/${build}/${tag}.json`,
    };
    await writeFile(record.files.server, serverHtml ?? '');
    await writeFile(record.files.client, atError?.html ?? (await page.content()));
    await writeFile(record.files.detail, JSON.stringify({ ...record, pageErrors, consoleErrors, mutations }, null, 2));
    await page.screenshot({ path: `${out}/${build}/${tag}.png` }).catch(() => {});
  } else if ((baselinesSaved.get(group) ?? 0) < BASELINES_PER_GROUP) {
    // Loads without an error, kept for comparison.
    baselinesSaved.set(group, (baselinesSaved.get(group) ?? 0) + 1);
    record.baseline = `${out}/baseline/${group}-${index}.json`;
    await writeFile(record.baseline, JSON.stringify({ ...record, mutations }, null, 2));
    if (serverHtml) await writeFile(`${out}/baseline/${group}-${index}-server.html`, serverHtml);
  }
  loads.push(record);
  console.log(
    `${build.padEnd(6)} ${arm.padEnd(8)} ${combo.lang} ${combo.width} #${index} +${Math.round((record.sinceSeedMs ?? 0) / 1000)}s ${hydration.length ? `HYDRATION ${record.hydration[0].slice(0, 60)}` : 'ok'}${record.navigationError ? ` (${record.navigationError})` : ''}`,
  );
  await context.close();
}

const available = {};
for (const build of Object.keys(BUILDS)) available[build] = await exists(BUILDS[build]);
console.log('builds present:', available);

for (let round = 0; round < ROUNDS; round++) {
  const order = round % 2 === 0 ? ['merged', 'main'] : ['main', 'merged'];
  for (const build of order) {
    if (!available[build]) continue;
    if (!(await start(build))) {
      console.log(`${build}: server did not answer /app with 200`);
      await stop();
      continue;
    }
    if (seedTime === null) {
      const current = await (await fetch(`${APP}/api/auth/get-session`, { headers: { cookie: cookieHeader } })).json().catch(() => null);
      seedTime = current?.user?.createdAt ? Date.parse(current.user.createdAt) : null;
      console.log(`seeded user created at ${current?.user?.createdAt}`);
    }
    for (const combo of COMBOS) {
      for (let index = 0; index < PER_COMBO; index++) await load(build, combo, round * PER_COMBO + index, 'live');
      for (let index = 0; index < REPLAYED_PER_COMBO; index++) await load(build, combo, round * REPLAYED_PER_COMBO + index, 'replayed');
    }
    await stop();
  }
}
await browser.close();

const summary = {};
for (const build of Object.keys(BUILDS)) {
  for (const arm of ARMS) {
    const mine = loads.filter((item) => item.build === build && item.arm === arm);
    const failing = mine.filter((item) => item.hydration.length);
    summary[`${build}/${arm}`] = {
      loads: mine.length,
      hydrationErrors: failing.length,
      rate: mine.length ? `${((failing.length / mine.length) * 100).toFixed(1)}%` : 'not run',
      navigationErrors: mine.filter((item) => item.navigationError).length,
      byCombo: Object.fromEntries(
        COMBOS.map((combo) => {
          const group = mine.filter((item) => item.lang === combo.lang && item.width === combo.width);
          return [`${combo.lang}-${combo.width}`, `${group.filter((item) => item.hydration.length).length}/${group.length}`];
        }),
      ),
      failingLoads: failing.map((item) => ({
        lang: item.lang,
        width: item.width,
        sinceSeedS: item.sinceSeedMs === null ? null : Math.round(item.sinceSeedMs / 1000),
        error: item.hydration[0].slice(0, 160),
        serverOnlyText: item.serverOnlyText,
        clientOnlyText: item.clientOnlyText,
        removedByClient: item.removedByClient,
        addedByClient: item.addedByClient,
        timing: item.timing,
        files: item.files,
      })),
    };
  }
}
await writeFile(
  `${out}/summary.json`,
  JSON.stringify({ revision: process.env.GITHUB_SHA, mainRevision: process.env.MAIN_REVISION, seedTime: seedTime && new Date(seedTime).toISOString(), summary, loads }, null, 2),
);
console.log(
  JSON.stringify(
    Object.fromEntries(Object.entries(summary).map(([key, value]) => [key, { loads: value.loads, hydrationErrors: value.hydrationErrors, rate: value.rate, byCombo: value.byCombo }])),
    null,
    2,
  ),
);
