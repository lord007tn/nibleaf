// Before/after captures for the server-rendered interface locale (#543, #546).
// Runs against a production app (APP_URL, default :4310) and API that the
// operator started while holding the machine-wide dev-stack lock; see README.md.
//
//   node --import tsx tests/integration/ssr-locale-direction/capture.mjs <before|after>
//
// Writes, per phase, into .github/assets/fix-ssr-locale-direction/:
// - cls-<phase>.json: layout shifts for every profile (page × visitor × width), 3 runs each;
// - nojs-<phase>-<page>-<locale>-<width>.png: first paint with JavaScript disabled;
// and screencast frames of an Arabic visitor landing on sign-in and the dashboard
// into .tmp/ssr-locale-direction/frames/<phase>-<page>/ (encoded to GIFs separately).
// With both cls-*.json files present it prints the before/after Markdown table.
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getDb } from '../../../packages/database/src/client.ts';
import { hostKey, withLocalOnlyBrowser } from '../lib/capture-env.mjs';

const phase = process.argv[2];
assert.ok(['before', 'after'].includes(phase), 'Pass the phase: before or after');
assert.ok(process.env.NIBLEAF_DEVSTACK_LOCK, 'Set NIBLEAF_DEVSTACK_LOCK to the machine-wide dev-stack lock');
assert.ok(existsSync(process.env.NIBLEAF_DEVSTACK_LOCK), 'Hold the dev-stack lock while the stack runs');
assert.ok(process.env.POSTGRES_URL && process.env.BETTER_AUTH_SECRET, 'Load the stack environment (POSTGRES_URL, BETTER_AUTH_SECRET)');

const APP = process.env.APP_URL ?? 'http://localhost:4310';
const RUNS = Number(process.env.RUNS ?? 3);
const root = resolve(import.meta.dirname, '../../..');
const output = resolve(root, '.github/assets/fix-ssr-locale-direction');
const frames = resolve(root, '.tmp/ssr-locale-direction/frames');

const pages = [
  { id: 'home', path: '/', signedIn: false },
  { id: 'sign-in', path: '/sign-in', signedIn: false },
  { id: 'sign-up', path: '/sign-up', signedIn: false },
  { id: 'dashboard', path: '/app', signedIn: true },
];
// An Arabic visitor arrives either with only Accept-Language (first visit) or
// with the locale cookie the language menu sets (NIBLEAF_LOCALE, read by both builds).
const visitors = [
  { id: 'en', locale: 'en-US', cookie: null },
  { id: 'ar', locale: 'ar', cookie: null },
  { id: 'ar-cookie', locale: 'en-US', cookie: 'ar' },
];
const widths = [390, 1440];

// Collects every layout shift from the start of each document.
const observeShifts = () => {
  window.__shifts = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries())
      window.__shifts.push({ value: entry.value, hadRecentInput: entry.hadRecentInput, startTime: entry.startTime });
  }).observe({ type: 'layout-shift', buffered: true });
};
// Total of shifts without recent input, and the web-vitals CLS (largest session window: 1 s gap, 5 s cap).
const score = (shifts) => {
  const counted = shifts.filter((shift) => !shift.hadRecentInput);
  let windowValue = 0;
  let windowStart = 0;
  let last = 0;
  let cls = 0;
  for (const shift of counted) {
    if (windowValue && (shift.startTime - last > 1000 || shift.startTime - windowStart > 5000)) windowValue = 0;
    if (!windowValue) windowStart = shift.startTime;
    windowValue += shift.value;
    last = shift.startTime;
    cls = Math.max(cls, windowValue);
  }
  return { total: counted.reduce((sum, shift) => sum + shift.value, 0), cls, count: counted.length };
};
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const htmlTag = (html) => html.match(/<html[^>]*>/)?.[0] ?? '';

const db = getDb({ connectionString: process.env.POSTGRES_URL });
let session;
let browser;
try {
  const user = await db.user.findUniqueOrThrow({ where: { email: 'demo@nibleaf.test' } });
  const member = await db.member.findFirstOrThrow({ where: { userId: user.id } });
  const token = randomUUID();
  session = await db.session.create({
    data: { userId: user.id, token, expiresAt: new Date(Date.now() + 3_600_000), activeOrganizationId: member.organizationId },
  });
  const signed = encodeURIComponent(`${token}.${createHmac('sha256', process.env.BETTER_AUTH_SECRET).update(token).digest('base64')}`);

  // Only these hosts are reachable (capture-env.mjs); anything else fails the run.
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(APP)], launch: { headless: true } }, async ({ browser: guarded }) => {
    browser = guarded;
    const open = async ({ page, visitor, width, javaScriptEnabled = true }) => {
      const context = await browser.newContext({
        viewport: { width, height: width === 390 ? 844 : 900 },
        isMobile: width === 390,
        hasTouch: width === 390,
        deviceScaleFactor: 1,
        locale: visitor.locale,
        javaScriptEnabled,
        reducedMotion: 'reduce',
      });
      const cookies = [];
      if (visitor.cookie) cookies.push({ name: 'NIBLEAF_LOCALE', value: visitor.cookie, url: APP });
      if (page.signedIn) cookies.push({ name: 'better-auth.session_token', value: signed, url: APP, httpOnly: true, sameSite: 'Lax' });
      await context.addCookies(cookies);
      await context.addInitScript(observeShifts);
      return context;
    };
    const settle = async (tab) => {
      await tab.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      await tab.waitForTimeout(2500);
    };

    // 1. Layout shifts.
    const profiles = [];
    for (const page of pages)
      for (const visitor of visitors)
        for (const width of widths) {
          const runs = [];
          for (let run = 0; run < RUNS; run++) {
            const context = await open({ page, visitor, width });
            const tab = await context.newPage();
            const response = await tab.goto(`${APP}${page.path}`, { waitUntil: 'load' });
            const served = htmlTag(await response.text());
            await settle(tab);
            const result = await tab.evaluate(() => ({
              shifts: window.__shifts,
              lang: document.documentElement.lang,
              dir: document.documentElement.dir,
              path: location.pathname,
            }));
            runs.push({ ...score(result.shifts), served, final: { lang: result.lang, dir: result.dir, path: result.path } });
            await context.close();
          }
          const profile = {
            page: page.id,
            visitor: visitor.id,
            width,
            cls: median(runs.map((r) => r.cls)),
            total: median(runs.map((r) => r.total)),
            runs,
          };
          profiles.push(profile);
          console.log(
            `${phase} ${page.id} ${visitor.id} ${width}: CLS ${profile.cls.toFixed(4)} (${runs.map((r) => r.cls.toFixed(4)).join(', ')}) ${runs[0].served} → ${runs[0].final.dir} ${runs[0].final.path}`,
          );
        }
    await mkdir(output, { recursive: true });
    await writeFile(resolve(output, `cls-${phase}.json`), `${JSON.stringify({ phase, app: APP, runsPerProfile: RUNS, profiles }, null, 2)}\n`);

    // 2. First paint with JavaScript disabled: what the server sends, before any script runs.
    for (const page of pages.filter((p) => ['sign-in', 'dashboard'].includes(p.id)))
      for (const visitor of visitors.filter((v) => v.id !== 'ar-cookie'))
        for (const width of widths) {
          const context = await open({ page, visitor, width, javaScriptEnabled: false });
          const tab = await context.newPage();
          await tab.goto(`${APP}${page.path}`, { waitUntil: 'load' });
          await tab.waitForTimeout(500);
          await tab.screenshot({ path: resolve(output, `nojs-${phase}-${page.id}-${visitor.id}-${width}.png`) });
          await context.close();
        }

    // 3. Screencast of an Arabic visitor (Accept-Language only) landing, CPU throttled 4× like a mid-range phone.
    for (const page of pages.filter((p) => ['sign-in', 'dashboard'].includes(p.id))) {
      const dir = resolve(frames, `${phase}-${page.id}`);
      await rm(dir, { recursive: true, force: true });
      await mkdir(dir, { recursive: true });
      const context = await open({ page, visitor: visitors[1], width: 1440 });
      const tab = await context.newPage();
      const cdp = await context.newCDPSession(tab);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const shots = [];
      cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
        shots.push({ data, timestamp: metadata.timestamp });
        cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
      });
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 80, maxWidth: 1440, maxHeight: 900, everyNthFrame: 1 });
      const start = Date.now() / 1000;
      await tab.goto(`${APP}${page.path}`, { waitUntil: 'load' });
      await settle(tab);
      await cdp.send('Page.stopScreencast');
      for (const [index, shot] of shots.entries()) {
        const ms = Math.max(0, Math.round((shot.timestamp - start) * 1000));
        await writeFile(resolve(dir, `${String(index).padStart(4, '0')}-${ms}.jpg`), Buffer.from(shot.data, 'base64'));
      }
      console.log(`${phase} ${page.id}: ${shots.length} screencast frames`);
      await context.close();
    }

    // 4. The before/after table, once both phases are captured.
    const files = ['before', 'after'].map((p) => resolve(output, `cls-${p}.json`));
    if (files.every(existsSync)) {
      const [before, after] = await Promise.all(files.map(async (file) => JSON.parse(await readFile(file, 'utf8')).profiles));
      const label = { en: 'EN', ar: 'AR (Accept-Language)', 'ar-cookie': 'AR (cookie)' };
      const lines = ['| Page | Visitor | Width | Before | After |', '| --- | --- | --- | --- | --- |'];
      for (const b of before) {
        const a = after.find((p) => p.page === b.page && p.visitor === b.visitor && p.width === b.width);
        lines.push(`| ${b.page} | ${label[b.visitor]} | ${b.width} | ${b.cls.toFixed(4)} | ${a ? a.cls.toFixed(4) : 'n/a'} |`);
      }
      console.log(lines.join('\n'));
    }
  });
} finally {
  await browser?.close();
  if (session) await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
  await db.$disconnect();
}
