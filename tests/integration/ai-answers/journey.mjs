// "Turn on AI answers" end to end, for PR media (operations/ux/ai-and-integrations.md, PR 3).
//
// Runs against a real local stack, which this script drives through commands
// you pass in, so nothing machine-specific lives here:
//   STACK_UP      "<command>"  started with the server type as its last argument
//                              (managed | own-key | no-key); prints PROJECT_ID=<id> on its last line
//   STACK_RESET   "<command>"  back to "AI answers off, docs not prepared" (server type as argument)
//   STACK_DOWN    "<command>"  stops everything the stack started
//   STACK_SOURCES "<command>"  optional; run with the phase as argument before that
//                              phase's stacks (e.g. check out main's sources for "before")
//   MAILPIT_URL   the stack's Mailpit API, where the sign-in code arrives
//   APP_URL       the dashboard (default http://localhost:4310)
//   PHASES        before,after (default); each label goes on its files
//   OUTPUT        where the JPEGs go (default .github/assets/feat-ai-answers-page)
//
// One invocation owns the machine-wide dev-stack lock (NIBLEAF_DEVSTACK_LOCK sets
// its path) for the whole run, both phases included. It refuses to start a stack
// while something already answers on APP_URL, and it keeps the lock if the
// stack is still answering after STACK_DOWN, so a stack never runs unlocked.
// It never presses anything that reaches an AI provider: turning answers on only
// saves the choice and queues preparation, which no search worker picks up here.
import { execSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { acquireDevstackLock, chromiumExecutable } from '../lib/capture-env.mjs';

const root = resolve(import.meta.dirname, '../../..');
const { STACK_UP, STACK_RESET, STACK_DOWN, STACK_SOURCES, MAILPIT_URL } = process.env;
if (!STACK_UP || !STACK_RESET || !STACK_DOWN || !MAILPIT_URL) throw new Error('Set STACK_UP, STACK_RESET, STACK_DOWN and MAILPIT_URL');
const APP = process.env.APP_URL ?? 'http://localhost:4310';
const PHASES = (process.env.PHASES ?? 'before,after').split(',').filter((phase) => phase === 'before' || phase === 'after');
const OUTPUT = resolve(root, process.env.OUTPUT ?? '.github/assets/feat-ai-answers-page');
// Server types: managed (the server runs the AI), own-key (no server AI, a saved
// OpenAI key) and no-key (no server AI, no key saved yet: production today).
// "before" is the reference, so it takes one colour scheme; no-key has no old journey.
const PLAN = {
  before: { servers: ['managed', 'own-key'], schemes: ['light'] },
  after: { servers: ['managed', 'own-key', 'no-key'], schemes: ['light', 'dark'] },
};
const EMAIL = 'demo@nibleaf.test';
// The old page's "turn on" button, by language (the new page has one switch).
const ENABLE = { en: 'Enable with this provider', ar: 'التفعيل بهذا المزوّد' };
const ADD_KEY = { en: 'Add key', ar: 'إضافة مفتاح' };

let runs = 0;
/**
 * Runs a stack command and returns what it printed. Output goes through a file,
 * not a pipe: servers the command leaves running would otherwise hold the pipe
 * open, and this would wait for them forever. Each run gets its own file, since
 * on Windows those servers can also keep the previous run's file open.
 */
const run = (command) => {
  const output = resolve(tmpdir(), `ai-answers-journey-${process.pid}-${++runs}.out`);
  const printed = () => {
    try {
      return readFileSync(output, 'utf8');
    } catch {
      return '';
    }
  };
  try {
    execSync(`${command} > "${output}" 2>&1`, { cwd: root, stdio: 'ignore' });
  } catch (error) {
    throw new Error(`${command} failed:\n${printed().slice(-2000)}`, { cause: error });
  }
  const text = printed();
  try {
    rmSync(output, { force: true });
  } catch {
    // A server the command started may still hold it open on Windows; the OS temp dir clears it later.
  }
  return text;
};

/** Whether anything answers on the dashboard's address. */
const appAnswers = async () => {
  try {
    await fetch(APP, { signal: AbortSignal.timeout(3000) });
    return true;
  } catch {
    return false;
  }
};

async function signIn(browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${APP}/sign-in`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
  const headers = { Origin: APP };
  const send = await page.request.post(`${APP}/api/auth/email-otp/send-verification-otp`, { data: { email: EMAIL, type: 'sign-in' }, headers });
  if (!send.ok()) throw new Error(`sign-in code: ${send.status()}`);
  let code;
  for (let i = 0; i < 120 && !code; i++) {
    await new Promise((done) => setTimeout(done, 1000));
    const list = await (await fetch(`${MAILPIT_URL}/api/v1/messages`)).json();
    const id = list.messages?.[0]?.ID;
    if (!id) continue;
    const message = await (await fetch(`${MAILPIT_URL}/api/v1/message/${id}`)).json();
    code = /\b(\d{6})\b/.exec(`${message.Subject} ${message.Text}`)?.[1];
  }
  if (!code) throw new Error('no sign-in code arrived');
  const signedIn = await page.request.post(`${APP}/api/auth/sign-in/email-otp`, { data: { email: EMAIL, otp: code }, headers });
  if (!signedIn.ok()) throw new Error(`sign-in: ${signedIn.status()}`);
  const state = await context.storageState();
  await context.close();
  return state;
}

async function open(page, projectId, section) {
  await page.goto(`${APP}/app/projects/${projectId}/settings?section=${section}`, { waitUntil: 'load', timeout: 180_000 });
  await page.locator('main').first().waitFor({ timeout: 180_000 });
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 90_000 }).catch(() => undefined);
  await page.waitForTimeout(1500);
}

const shot = async (page, name) => {
  // A full-page shot of a scrolled inner container stitches the sticky header mid-image: back to the top first.
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('*')) if (element.scrollTop) element.scrollTop = 0;
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: resolve(OUTPUT, `${name}.jpg`), type: 'jpeg', quality: 70, fullPage: true });
};

/** The journey: the page with answers off, the one action that turns them on, and the result. */
async function journey(page, phase, projectId, server, locale, tag) {
  if (phase === 'after') {
    await open(page, projectId, 'ai');
    await shot(page, `${tag}-1-off`);
    if (server === 'no-key') {
      // The switch waits for a key; the first step is adding one (never saved here).
      await page.getByRole('button', { name: ADD_KEY[locale] }).first().click();
      await page.waitForTimeout(1500);
      await shot(page, `${tag}-2-add-key`);
      await open(page, projectId, 'search');
      await shot(page, `${tag}-3-search`);
      return;
    }
    await page.getByRole('switch').first().click();
    await page.waitForTimeout(2500);
    await shot(page, `${tag}-2-on`);
    await open(page, projectId, 'search');
    await shot(page, `${tag}-3-search`);
    return;
  }
  // Before: Smart AI, where "on" is a provider card's button (Nibleaf AI's is the last card, own keys the first).
  await open(page, projectId, 'smartAi');
  await shot(page, `${tag}-1-off`);
  const buttons = page.getByRole('button', { name: ENABLE[locale] });
  const enable = server === 'managed' ? buttons.last() : buttons.first();
  await enable.scrollIntoViewIfNeeded();
  await enable.click();
  await page.waitForTimeout(2500);
  await shot(page, `${tag}-2-on`);
  await open(page, projectId, 'search');
  await shot(page, `${tag}-3-search`);
}

async function capture(browser, phase, server) {
  if (await appAnswers()) throw new Error(`${APP} already answers: another stack is using its port`);
  console.log(`stack up: ${phase} ${server}`);
  const projectId = /PROJECT_ID=(\S+)\s*$/.exec(run(`${STACK_UP} ${server}`))?.[1];
  if (!projectId) throw new Error(`STACK_UP ${server} printed no PROJECT_ID`);
  const state = await signIn(browser);
  for (const scheme of PLAN[phase].schemes) {
    for (const locale of ['en', 'ar']) {
      for (const width of [1440, 390]) {
        run(`${STACK_RESET} ${server}`);
        const mobile = width < 500;
        const context = await browser.newContext({
          storageState: state,
          viewport: { width, height: mobile ? 844 : 900 },
          colorScheme: scheme,
          isMobile: mobile,
          hasTouch: mobile,
        });
        await context.addCookies([{ name: 'NIBLEAF_LOCALE', value: locale, url: APP }]);
        const page = await context.newPage();
        const tag = `${phase}-${server}-${locale}-${width}-${scheme}`;
        console.log(`journey ${tag}`);
        await journey(page, phase, projectId, server, locale, tag);
        await context.close();
      }
    }
  }
  run(STACK_DOWN);
}

await mkdir(OUTPUT, { recursive: true });
const lock = await acquireDevstackLock(`feat/ai-answers-page journey (${PHASES.join(', ')})\n${root}`);
let browser;
try {
  browser = await chromium.launch({ executablePath: chromiumExecutable() });
  for (const phase of PHASES) {
    if (STACK_SOURCES) {
      console.log(`sources: ${phase}`);
      run(`${STACK_SOURCES} ${phase}`);
    }
    for (const server of PLAN[phase].servers) await capture(browser, phase, server);
  }
  console.log(`shots in ${OUTPUT}`);
} finally {
  await browser?.close();
  try {
    run(STACK_DOWN);
  } catch (error) {
    // Never hide the run's own failure behind a teardown problem.
    console.error(`teardown: ${error instanceof Error ? error.message : error}`);
  }
  if (await appAnswers()) {
    // Releasing now would leave a stack running unlocked; stop it by hand, then remove the lock.
    console.error(`teardown left ${APP} answering; keeping the lock at ${lock.path}`);
    process.exitCode = 1;
  } else {
    await lock.release();
    console.log('lock released');
  }
}
