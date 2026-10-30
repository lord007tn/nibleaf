// Disposable rehearsal: walks real Chromium through the merged reader and
// dashboard builds in English and Arabic. Reader sites come from the fixture
// mock; dashboard pages use a throwaway local API and database seeded with a
// synthetic user. Nothing here contacts a public host.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chevronDirection } from './png.mjs';

const { chromium } = await import(process.env.BROWSER_MODULE);
const out = process.env.OUT ?? 'output/ui-browser';
await mkdir(`${out}/shots`, { recursive: true });
const APP = 'http://localhost:4310';
const MOCK = 'http://localhost:4311';
const LANGS = ['en', 'ar'];
const THEMES = { harbor: 'preview-harbor', manuscript: 'preview-manuscript', signal: 'preview-signal', legacy: 'preview-legacy' };
const catalogs = {
  en: JSON.parse(await readFile('packages/i18n/messages/en.json', 'utf8')),
  ar: JSON.parse(await readFile('packages/i18n/messages/ar.json', 'utf8')),
};
const m = (lang, key) => {
  const value = catalogs[lang][key];
  if (typeof value !== 'string') throw new Error(`missing message ${key}`);
  return value;
};
const TITLES = {
  retries: { en: 'Webhook retries', ar: 'إعادة محاولة الويب هوك' },
  pkce: { en: 'PKCE flow', ar: 'تدفق PKCE' },
};
const site = (project, path, lang) => `${APP}/sites/${project}/${path}${lang === 'ar' ? '?lang=ar' : ''}`;
const results = [];
let shotIndex = 0;

const session = process.env.SESSION_FILE ? JSON.parse(await readFile(process.env.SESSION_FILE, 'utf8')) : null;

// Readiness: reader through the mock, and the signed-in dashboard through the local API.
const waitFor = async (url, accept = (status) => status < 500) => {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
      if (accept(response.status)) return true;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
};
const readerUp = await waitFor(site(THEMES.harbor, 'getting-started/introduction', 'en'), (status) => status === 200);
const apiUp = await waitFor(`${MOCK}/api/public/meta`, (status) => status === 200);
console.log(`reader available: ${readerUp}, local API available: ${apiUp}, session: ${Boolean(session)}`);

// The default `--hide-scrollbars` would make row 7's scrollbar unobservable.
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });

const HYDRATION = /hydrat|Minified React error #(418|419|421|422|423|425)|did not match|server rendered HTML|server-rendered/i;

class Failure extends Error {}

async function run(row, lang, variant, body, options = {}) {
  const device = options.device ?? 'desktop';
  const record = { row, lang, variant, device, status: 'fail', checks: [], pageErrors: [], consoleErrors: [], screenshots: [] };
  if (options.needs === 'reader' && !readerUp) {
    record.status = 'not run';
    record.reason = 'reader server did not start';
    results.push(record);
    return record;
  }
  if (options.needs === 'dashboard' && !(apiUp && session)) {
    record.status = 'not run';
    record.reason = `local API ${apiUp ? 'up' : 'down'}, session ${session ? 'ready' : 'missing'}`;
    results.push(record);
    return record;
  }
  const context = await browser.newContext({
    viewport: device === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    isMobile: device === 'mobile',
    hasTouch: device === 'mobile',
    deviceScaleFactor: options.scale ?? 1,
    locale: lang === 'ar' ? 'ar' : 'en-US',
    javaScriptEnabled: options.javaScript !== false,
    timezoneId: 'UTC',
    colorScheme: 'light',
  });
  await context.addCookies([{ name: 'NIBLEAF_LOCALE', value: lang, url: APP }]);
  if (options.needs === 'dashboard') await context.addCookies(session.cookies.map((cookie) => ({ ...cookie, url: APP })));
  // Mock-only rehearsal: anything that is not this runner is refused.
  await context.route('**/*', (route) => (['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.fallback() : route.abort()));
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => record.pageErrors.push(`${page.url()} :: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') record.consoleErrors.push(`${page.url()} :: ${message.text()}`.slice(0, 600));
  });
  const name = `${row}-${lang}-${device}-${variant}`.replace(/[^a-z0-9-]+/gi, '_');
  const tools = {
    page,
    context,
    record,
    lang,
    device,
    shot: async (label, target, shotOptions = {}) => {
      const path = `${out}/shots/${String(++shotIndex).padStart(3, '0')}-${name}-${label}.png`;
      const subject = target ?? page;
      await subject.screenshot({ path, ...shotOptions });
      record.screenshots.push(path);
      return path;
    },
    check: (label, ok, detail) => {
      record.checks.push({ label, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) });
      if (!ok) throw new Failure(`${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail).slice(0, 400)}`}`);
    },
    note: (label, detail) => record.checks.push({ label, note: true, detail }),
  };
  try {
    await body(tools);
    const hydration = record.consoleErrors.filter((text) => HYDRATION.test(text));
    tools.check('no uncaught exceptions', record.pageErrors.length === 0, record.pageErrors[0]);
    tools.check('no hydration errors in the console', hydration.length === 0, hydration[0]);
    record.status = 'pass';
  } catch (error) {
    record.reason = error instanceof Failure ? error.message : `harness: ${error.message.split('\n')[0]}`;
    record.harnessError = !(error instanceof Failure);
    await tools.shot('at-failure').catch(() => {});
  } finally {
    results.push(record);
    console.log(`${record.status.toUpperCase().padEnd(7)} ${row} ${lang} ${device} ${variant}${record.reason ? ` — ${record.reason}` : ''}`);
    await context.close();
  }
  return record;
}

// ─── Reader helpers ──────────────────────────────────────────────────────────

const hydrated = (page, selector) =>
  page.waitForFunction((css) => {
    const node = document.querySelector(css);
    return Boolean(node && Object.keys(node).some((key) => key.startsWith('__reactProps')));
  }, selector, { timeout: 20000 });

const openReader = async ({ page }, project, path, lang) => {
  await page.goto(site(project, path, lang), { waitUntil: 'networkidle' });
  await page.locator('main h1').first().waitFor();
};

/** The visible reader navigation: the sidebar on desktop, the sheet on mobile. */
const readerNav = async ({ page, device }) => {
  if (device === 'mobile') {
    await hydrated(page, 'button[data-slot="sheet-trigger"]');
    await page.locator('button[data-slot="sheet-trigger"]').first().click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    // Let the sheet finish sliding in before anything is measured.
    await dialog.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished)));
    return dialog.locator('nav[data-site-nav]');
  }
  const nav = page.locator('nav[data-site-nav]').filter({ visible: true }).first();
  await nav.waitFor();
  await hydrated(page, 'nav[data-site-nav] button[aria-controls]');
  return nav;
};

const toggleFor = (nav, path) => nav.locator(`a[href*="/${path}"]`).first().locator('xpath=following-sibling::button');

const branchState = (nav) =>
  nav.evaluate((root) =>
    [...root.querySelectorAll('button[aria-controls]')].map((button) => {
      const list = document.getElementById(button.getAttribute('aria-controls'));
      const link = button.previousElementSibling;
      return {
        path: new URL(link.href).pathname.split('/').slice(3).join('/'),
        expanded: button.getAttribute('aria-expanded'),
        controlsExists: Boolean(list),
        listHidden: list ? list.hidden : null,
        listDisplayed: list ? getComputedStyle(list).display !== 'none' : null,
        holdsCurrent: link.getAttribute('aria-current') === 'page' || Boolean(list?.querySelector('a[aria-current="page"]')),
      };
    }),
  );

const markDocument = (page) => page.evaluate(() => { window.__rehearsalDocument = 'original'; });
const sameDocument = (page) => page.evaluate(() => window.__rehearsalDocument === 'original');

async function chevronPointing(page, button) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(350);
  const svg = button.locator('svg');
  const css = await svg.evaluate((node) => {
    const style = getComputedStyle(node);
    return { rotate: style.rotate, scale: style.scale, transform: style.transform, direction: getComputedStyle(node.closest('nav')).direction };
  });
  const png = await button.screenshot();
  return { ...chevronDirection(png), css };
}

// ─── Rows 1–9: reader sidebar, crawler HTML, scrollbars, Mermaid, hydration ──

for (const lang of LANGS) {
  for (const [theme, project] of Object.entries(THEMES)) {
    for (const device of ['desktop', 'mobile']) {
      await run('1-sidebar-default', lang, theme, async (t) => {
        const { page, check, shot } = t;
        await openReader(t, project, 'getting-started/introduction', lang);
        let nav = await readerNav(t);
        const onIntro = await branchState(nav);
        t.note('branches on the introduction page', onIntro);
        check('introduction page: every page branch starts collapsed', onIntro.length >= 4 && onIntro.every((b) => b.expanded === 'false' && b.listHidden === true && b.listDisplayed === false), onIntro);
        await shot('intro-nav', device === 'mobile' ? page.getByRole('dialog') : page.locator('[data-theme-region="sidebar"]').filter({ visible: true }).first());
        await openReader(t, project, 'guides/auth-oauth-pkce', lang);
        nav = await readerNav(t);
        const onLeaf = await branchState(nav);
        t.note('branches on guides/auth-oauth-pkce', onLeaf);
        check('aria-controls of every toggle points at an element', onLeaf.every((b) => b.controlsExists));
        check('only the branches holding the current page are expanded', onLeaf.every((b) => b.expanded === String(b.holdsCurrent) && b.listHidden === !b.holdsCurrent), onLeaf);
        const byPath = Object.fromEntries(onLeaf.map((b) => [b.path, b.expanded]));
        check('Authentication and OAuth expanded, Webhooks and Shipments collapsed', byPath['guides/authentication'] === 'true' && byPath['guides/auth-oauth'] === 'true' && byPath['guides/webhooks'] === 'false' && byPath['reference/shipments'] === 'false', byPath);
        check('current page link is visible', await nav.locator('a[aria-current="page"]').isVisible());
        await shot('leaf-nav', device === 'mobile' ? page.getByRole('dialog') : page.locator('[data-theme-region="sidebar"]').filter({ visible: true }).first());
      }, { device, needs: 'reader' });
    }
  }

  for (const theme of ['harbor', 'signal']) {
    for (const device of ['desktop', 'mobile']) {
      await run('2-toggle', lang, theme, async (t) => {
        const { page, check, shot } = t;
        await openReader(t, THEMES[theme], 'getting-started/introduction', lang);
        const nav = await readerNav(t);
        await markDocument(page);
        const before = page.url();
        const heading = await page.locator('main h1').first().textContent();
        const toggle = toggleFor(nav, 'guides/webhooks');
        const child = nav.locator('a[href*="/guides/webhook-retries"]');
        const linkText = (await nav.locator('a[href*="/guides/webhooks"]').first().textContent()).trim();
        const accessibleName = `${m(lang, 'site_togglesubpages')} ${linkText}`;
        check('toggle has the localized accessible name', (await nav.getByRole('button', { name: accessibleName, exact: true }).count()) === 1, accessibleName);
        const controls = await toggle.getAttribute('aria-controls');
        check('collapsed: aria-expanded=false, list hidden, child not visible', (await toggle.getAttribute('aria-expanded')) === 'false' && !(await child.isVisible()));
        await toggle.click();
        await page.waitForTimeout(300);
        check('expanded: aria-expanded=true', (await toggle.getAttribute('aria-expanded')) === 'true');
        check('aria-controls is stable and names the shown list', (await toggle.getAttribute('aria-controls')) === controls && (await page.evaluate((id) => document.getElementById(id)?.hidden === false, controls)));
        check('expanded: child link visible', await child.isVisible());
        check('toggle did not navigate', page.url() === before && (await sameDocument(page)) && (await page.locator('main h1').first().textContent()) === heading, { before, after: page.url() });
        if (device === 'mobile') check('mobile sheet stays open after toggling', await page.getByRole('dialog').isVisible());
        await shot('expanded', device === 'mobile' ? page.getByRole('dialog') : undefined);
        await toggle.click();
        await page.waitForTimeout(300);
        check('collapsed again: aria-expanded=false and list hidden', (await toggle.getAttribute('aria-expanded')) === 'false' && (await page.evaluate((id) => document.getElementById(id)?.hidden === true, controls)) && !(await child.isVisible()));
        await nav.locator('a[href*="/guides/webhooks"]').first().click();
        await page.waitForFunction(() => location.pathname.endsWith('/guides/webhooks'));
        await page.waitForFunction((old) => document.querySelector('main h1')?.textContent !== old, heading);
        check('page link navigates', page.url().includes('/guides/webhooks'), page.url());
        t.note('client-side navigation kept the document', await sameDocument(page));
        await shot('after-link');
      }, { device, needs: 'reader' });
    }
  }

  await run('3-keyboard', lang, 'harbor', async (t) => {
    const { page, check, shot } = t;
    await openReader(t, THEMES.harbor, 'getting-started/introduction', lang);
    const nav = await readerNav(t);
    const link = nav.locator('a[href*="/guides/webhooks"]').first();
    const toggle = toggleFor(nav, 'guides/webhooks');
    await link.focus();
    await page.keyboard.press('Tab');
    check('Tab from the page link reaches its chevron', await toggle.evaluate((node) => node === document.activeElement));
    await shot('chevron-focused', page.locator('[data-theme-region="sidebar"]').filter({ visible: true }).first());
    await page.keyboard.press('Enter');
    check('Enter expands', (await toggle.getAttribute('aria-expanded')) === 'true');
    await page.keyboard.press('Space');
    check('Space collapses', (await toggle.getAttribute('aria-expanded')) === 'false');
    await page.keyboard.press('Space');
    check('Space expands', (await toggle.getAttribute('aria-expanded')) === 'true');
    await page.keyboard.press('Enter');
    check('Enter collapses', (await toggle.getAttribute('aria-expanded')) === 'false');
    check('keys did not navigate', page.url().includes('/getting-started/introduction'));
    await page.keyboard.press('Tab');
    const next = await page.evaluate(() => document.activeElement?.getAttribute('href') ?? document.activeElement?.tagName);
    check('Tab past a collapsed branch skips its subpages', typeof next === 'string' && next.includes('/guides/errors'), next);
    // Sweep every focus stop in the sidebar; none may sit inside a collapsed list.
    await nav.locator('a').first().focus();
    const stops = [];
    for (let i = 0; i < 160; i++) {
      const stop = await page.evaluate(() => {
        const node = document.activeElement;
        const nav = node?.closest('nav[data-site-nav]');
        return { inNav: Boolean(nav), inCollapsed: Boolean(node?.closest('ul[hidden]')), label: node?.getAttribute('href') ?? node?.getAttribute('aria-controls') ?? node?.tagName };
      });
      if (!stop.inNav) break;
      stops.push(stop);
      await page.keyboard.press('Tab');
    }
    t.note('focus stops in the sidebar', stops.length);
    check('no focus stop inside a collapsed list', stops.length > 10 && stops.every((stop) => !stop.inCollapsed), stops.filter((stop) => stop.inCollapsed));
  }, { needs: 'reader' });

  for (const theme of ['harbor', 'signal']) {
    for (const device of ['desktop', 'mobile']) {
      await run('4-chevron-direction', lang, theme, async (t) => {
        const { page, check, shot } = t;
        await openReader(t, THEMES[theme], 'getting-started/introduction', lang);
        const nav = await readerNav(t);
        const toggle = toggleFor(nav, 'guides/webhooks');
        const row = toggle.locator('xpath=..');
        const collapsed = await chevronPointing(page, toggle);
        await shot('collapsed-closeup', row);
        await toggle.click();
        const expanded = await chevronPointing(page, toggle);
        await shot('expanded-closeup', row);
        const inlineEnd = lang === 'ar' ? 'left' : 'right';
        t.note('collapsed chevron', collapsed);
        t.note('expanded chevron', expanded);
        check(`collapsed chevron points to the inline end (${inlineEnd})`, collapsed.direction === inlineEnd, collapsed);
        check('expanded chevron points down', expanded.direction === 'down', expanded);
      }, { device, needs: 'reader', scale: 4 });
    }
  }

  await run('5-crawler-html', lang, 'all-themes', async (t) => {
    const { page, check } = t;
    const expected = ['guides/auth-api-keys', 'guides/auth-oauth', 'guides/auth-oauth-pkce', 'guides/webhook-retries', 'guides/webhook-signatures', 'reference/shipments-create'];
    await page.goto('about:blank');
    for (const [theme, project] of Object.entries(THEMES)) {
      const response = await fetch(site(project, 'getting-started/introduction', lang));
      const html = await response.text();
      await writeFile(`${out}/raw-${theme}-${lang}.html`, html);
      const found = await page.evaluate((source) => {
        const doc = new DOMParser().parseFromString(source, 'text/html');
        return {
          collapsedLinks: [...doc.querySelectorAll('nav[data-site-nav] ul[hidden] a[href]')].map((a) => a.getAttribute('href')),
          noscriptRule: [...doc.querySelectorAll('nav[data-site-nav] noscript')].map((n) => n.textContent),
        };
      }, html);
      t.note(`${theme} raw HTML`, found);
      for (const path of expected) {
        check(`${theme}: raw HTML has collapsed link ${path}`, found.collapsedLinks.some((href) => href.includes(`/${path}`) && (lang === 'en' || href.includes('lang=ar'))), found.collapsedLinks);
      }
    }
  }, { needs: 'reader' });

  for (const [theme, project] of Object.entries(THEMES)) {
    await run('6-no-javascript', lang, theme, async (t) => {
      const { page, check, shot } = t;
      await page.goto(site(project, 'getting-started/introduction', lang));
      await page.locator('main h1').first().waitFor();
      const nav = page.locator('nav[data-site-nav]').filter({ visible: true }).first();
      const child = nav.locator('a[href*="/guides/webhook-retries"]');
      check('collapsed subpage link is visible without JavaScript', await child.isVisible());
      check('nested subpage (PKCE) is visible without JavaScript', await nav.locator('a[href*="/guides/auth-oauth-pkce"]').isVisible());
      await shot('nav', page.locator('[data-theme-region="sidebar"]').filter({ visible: true }).first());
      await child.click();
      await page.waitForURL(/\/guides\/webhook-retries/);
      const heading = (await page.locator('main h1').first().textContent()).trim();
      check('subpage link opens the subpage', heading === TITLES.retries[lang], heading);
    }, { javaScript: false, needs: 'reader' });
  }

  for (const theme of ['harbor', 'signal']) {
    await run('7-scrollbar', lang, theme, async (t) => {
      const { page, check, shot } = t;
      await openReader(t, THEMES[theme], 'getting-started/introduction', lang);
      await readerNav(t);
      const scroller = page.locator('.documentation-sidebar-scroll').filter({ visible: true }).first();
      const metrics = await scroller.evaluate((node) => ({
        scrollHeight: node.scrollHeight,
        clientHeight: node.clientHeight,
        scrollbarWidth: node.offsetWidth - node.clientWidth,
        overflowY: getComputedStyle(node).overflowY,
        scrollbarWidthCss: getComputedStyle(node).scrollbarWidth,
      }));
      t.note('sidebar metrics', metrics);
      check('sidebar content is taller than the sidebar', metrics.scrollHeight > metrics.clientHeight + 100, metrics);
      check('sidebar is a scroll container', ['auto', 'scroll'].includes(metrics.overflowY), metrics);
      check('a scrollbar gutter is drawn', metrics.scrollbarWidth > 0, metrics);
      await shot('top', page.locator('[data-theme-region="sidebar"]').filter({ visible: true }).first());
      const box = await scroller.boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.wheel(0, 1500);
      await page.waitForTimeout(500);
      const scrolled = await scroller.evaluate((node) => node.scrollTop);
      check('mouse wheel scrolls the sidebar', scrolled > 200, scrolled);
      check('the last catalog page can be reached', await page.evaluate(async () => {
        const node = document.querySelector('.documentation-sidebar-scroll');
        node.scrollTop = node.scrollHeight;
        await new Promise((resolve) => setTimeout(resolve, 200));
        const last = [...node.querySelectorAll('a[href*="/catalog/port-40"]')][0];
        const a = last.getBoundingClientRect();
        const b = node.getBoundingClientRect();
        return a.bottom <= b.bottom + 1 && a.top >= b.top - 1;
      }));
      await shot('bottom', page.locator('[data-theme-region="sidebar"]').filter({ visible: true }).first());
    }, { needs: 'reader' });
  }

  for (const [theme, project] of Object.entries(THEMES)) {
    await run('7-no-overflow-390', lang, theme, async (t) => {
      const { page, check, shot } = t;
      for (const path of ['getting-started/introduction', 'guides/auth-oauth-pkce', 'getting-started/architecture-diagram']) {
        await openReader(t, project, path, lang);
        await page.waitForTimeout(800);
        const overflow = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
        check(`${path}: page does not overflow horizontally`, overflow.scrollWidth <= overflow.clientWidth, overflow);
      }
      await shot('page');
      await readerNav(t);
      const dialog = page.getByRole('dialog');
      const sheet = await dialog.evaluate((node) => {
        const width = window.innerWidth;
        const offenders = [...node.querySelectorAll('a, button, span')].filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && (r.right > width + 1 || r.left < -1);
        }).map((el) => el.textContent.trim().slice(0, 40));
        const viewport = node.querySelector('[data-slot="scroll-area-viewport"]');
        return { offenders, scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, scrollable: viewport ? viewport.scrollHeight > viewport.clientHeight : null };
      });
      t.note('sheet', sheet);
      check('mobile navigation sheet has nothing outside the viewport', sheet.offenders.length === 0, sheet.offenders);
      const viewport = dialog.locator('[data-slot="scroll-area-viewport"]').first();
      if (sheet.scrollable) {
        await viewport.evaluate((node) => { node.scrollTop = node.scrollHeight; });
        check('mobile sheet scrolls', (await viewport.evaluate((node) => node.scrollTop)) > 0);
      }
      await shot('sheet', dialog);
    }, { device: 'mobile', needs: 'reader' });
  }

  for (const device of ['desktop', 'mobile']) {
    await run('8-mermaid', lang, 'harbor', async (t) => {
      const { page, check, shot } = t;
      await openReader(t, THEMES.harbor, 'getting-started/architecture-diagram', lang);
      const diagram = page.locator('main svg[id^="mermaid-"]').first();
      await diagram.waitFor({ timeout: 30000 });
      const facts = await diagram.evaluate((svg) => ({
        nodes: svg.querySelectorAll('g.node').length,
        edges: svg.querySelectorAll('.edgePath, .flowchart-link, path[class*="flowchart"]').length,
        text: svg.textContent.replace(/\s+/g, ' ').trim(),
        size: svg.getBoundingClientRect().toJSON(),
      }));
      t.note('diagram', facts);
      check('Mermaid rendered an SVG with four nodes', facts.nodes === 4, facts);
      const label = lang === 'ar' ? 'واجهة تايدووتر' : 'Tidewater API';
      check('node labels survived sanitizing', facts.text.includes(label), facts.text);
      check('raw fence fallback is gone', (await page.locator('main pre', { hasText: 'flowchart LR' }).count()) === 0);
      await diagram.scrollIntoViewIfNeeded();
      await shot('diagram', diagram.locator('xpath=..'));
    }, { device, needs: 'reader' });
  }

  for (const [theme, project] of Object.entries(THEMES)) {
    for (const device of ['desktop', 'mobile']) {
      await run('9-hydration', lang, theme, async (t) => {
        const { page, check, shot } = t;
        await openReader(t, project, 'getting-started/introduction', lang);
        await page.waitForTimeout(1500);
        await hydrated(page, 'main h1');
        await markDocument(page);
        await page.keyboard.press('Control+k');
        const dialog = page.getByRole('dialog');
        await dialog.waitFor();
        await page.locator('input[data-slot="command-input"]').fill(lang === 'ar' ? 'الويب' : 'Webhook');
        await page.getByRole('option').first().waitFor();
        check('search dialog returns results', (await page.getByRole('option').count()) > 0);
        await shot('search');
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        const nav = await readerNav(t);
        const toggle = toggleFor(nav, 'guides/webhooks');
        await toggle.click();
        check('sidebar toggle responds', (await toggle.getAttribute('aria-expanded')) === 'true');
        if (device === 'mobile') {
          await page.keyboard.press('Escape');
          await page.getByRole('dialog').waitFor({ state: 'hidden' });
        }
        if (device === 'desktop') {
          const target = lang === 'en' ? 'ar' : 'en';
          await page.locator('button').filter({ has: page.locator('span[lang]') }).filter({ visible: true }).first().click();
          await page.getByRole('menuitem').filter({ hasText: target === 'ar' ? 'العربية' : 'English' }).click();
          await page.waitForFunction((code) => document.documentElement.lang === code && document.documentElement.dir === (code === 'ar' ? 'rtl' : 'ltr'), target);
          check('language switch changed lang and dir', true);
          // Not part of this row: whether switching is a soft navigation belongs to the open navigation PR.
          t.note('language switch kept the same document', await sameDocument(page));
          await shot('after-language-switch');
        }
      }, { device, needs: 'reader' });
    }
  }

  // ─── Rows 10–12: reader AI control by capability ──────────────────────────

  for (const device of ['desktop', 'mobile']) {
    for (const [row, project] of [['10-ai-off', 'preview-ai-off'], ['11-ai-on', 'preview-ai-on'], ['12-ai-capabilities-missing', 'preview-ai-legacy']]) {
      await run(row, lang, 'harbor', async (t) => {
        const { page, check, shot } = t;
        await openReader(t, project, 'getting-started/introduction', lang);
        await page.waitForTimeout(1000);
        await hydrated(page, 'main h1');
        await page.keyboard.press('Control+k');
        await page.getByRole('dialog').waitFor();
        const tabs = page.getByRole('dialog').getByRole('tab');
        const askAi = page.getByText(m(lang, 'site_askai'), { exact: true });
        if (row !== '11-ai-on') {
          check('no AI tab in the search dialog', (await tabs.count()) === 0);
          check('no "Ask AI" text anywhere', (await askAi.count()) === 0);
          await page.locator('input[data-slot="command-input"]').fill(lang === 'ar' ? 'الويب' : 'Webhook');
          await page.getByRole('option').first().waitFor();
          check('plain search still works', (await page.getByRole('option').count()) > 0);
          await shot('search');
          return;
        }
        check('two search modes are offered', (await tabs.count()) === 2);
        check('AI tab is labelled in the page language', (await tabs.nth(1).textContent()).trim() === m(lang, 'site_askai'));
        await tabs.nth(1).click();
        await page.locator('input[data-slot="command-input"]').fill(lang === 'ar' ? 'كيف أستخدم مفتاح API؟' : 'How do I use an API key?');
        await page.getByRole('dialog').getByRole('button', { name: m(lang, 'site_answer') }).click();
        const answer = lang === 'ar' ? 'إجابة تجريبية' : 'Rehearsal answer';
        await page.getByRole('dialog').getByText(answer).first().waitFor();
        const recorded = (await (await fetch(`${MOCK}/__rehearsal`)).json()).answers.filter((item) => item.projectId === project);
        check('answer request reached the mock with the page language', recorded.some((item) => (item.lang ?? 'en') === lang), recorded);
        await shot('answer');
      }, { device, needs: 'reader' });
    }
  }
}

// ─── Rows 13–16: signed-in dashboard against the local API ──────────────────

const apiJson = async (context, method, path, body) => {
  const response = await context.request.fetch(`${APP}${path}`, {
    method,
    headers: { origin: APP, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { data: JSON.stringify(body) }),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: response.status(), json, text: text.slice(0, 300) };
};

/** Report AI as available in /meta, keeping every other field from the real response. */
const metaWithAi = async (context, ai) => {
  await context.route(`${APP}/api/public/meta`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.data = { ...body.data, ai };
    await route.fulfill({ response, json: body });
  });
};

const toast = (page, text) => page.locator('[data-sonner-toast]').filter({ hasText: text }).first();
const toastTexts = (page) => page.locator('[data-sonner-toast]').allTextContents();
const settle = (page) => page.waitForTimeout(700);

let demoProjectId = null;
let demoPageId = null;

for (const lang of LANGS) {
  for (const device of ['desktop', 'mobile']) {
    await run('13-new-site-dialog', lang, 'dashboard', async (t) => {
      const { page, check, shot, context } = t;
      await page.goto(`${APP}/app`, { waitUntil: 'networkidle' });
      check('signed-in dashboard loads', !page.url().includes('/sign-in'), page.url());
      await page.getByRole('heading', { name: m(lang, 'dashboard_title') }).waitFor();
      check('document language follows the locale cookie', (await page.evaluate(() => [document.documentElement.lang, document.documentElement.dir]).then(([l, d]) => l === lang && d === (lang === 'ar' ? 'rtl' : 'ltr'))));
      if (!demoProjectId) {
        const projects = await apiJson(context, 'GET', '/api/app/projects');
        demoProjectId = projects.json?.data?.[0]?.id ?? null;
      }
      await page.getByRole('button', { name: m(lang, 'dashboard_newproject') }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.getByText(m(lang, 'newsite_title')).waitFor();
      const input = dialog.locator('#new-project-name');
      const placeholder = await input.getAttribute('placeholder');
      check('placeholder is the translated one', placeholder === m(lang, 'newsite_nameplaceholder'), placeholder);
      if (lang === 'ar') check('Arabic placeholder is not the English one', placeholder !== m('en', 'newsite_nameplaceholder') && /[؀-ۿ]/.test(placeholder), placeholder);
      const submit = dialog.getByRole('button', { name: m(lang, 'newsite_create') });
      check('submit is disabled while empty', await submit.isDisabled());
      await shot('dialog-empty', dialog);
      await input.fill('x');
      await input.fill('');
      await input.blur();
      const requiredMessage = m(lang, 'validation_required').replace('{label}', m(lang, 'newsite_name'));
      await dialog.getByText(requiredMessage).waitFor();
      check('empty name shows the translated required message', true, requiredMessage);
      await shot('dialog-invalid', dialog);
      const name = `Rehearsal ${lang} ${device} ${Date.now() % 100000}`;
      await input.fill(name);
      const created = page.waitForResponse((response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/app/projects');
      await submit.click();
      const response = await created;
      check('create request succeeds', response.ok(), response.status());
      await toast(page, m(lang, 'newsite_created')).waitFor();
      t.note('toasts', await toastTexts(page));
      await dialog.waitFor({ state: 'hidden' });
      await page.getByText(name).first().waitFor();
      check('new site appears on the dashboard', true);
      await settle(page);
      await shot('created');
    }, { device, needs: 'dashboard' });
  }
}

async function editorPage(t) {
  const { page, context } = t;
  if (!demoProjectId) {
    const projects = await apiJson(context, 'GET', '/api/app/projects');
    demoProjectId = projects.json?.data?.[0]?.id ?? null;
  }
  t.check('a seeded project exists', demoProjectId, demoProjectId);
  await page.goto(`${APP}/app/projects/${demoProjectId}/editor`, { waitUntil: 'networkidle' });
  await page.locator('.ProseMirror').first().waitFor({ timeout: 30000 });
}

for (const lang of LANGS) {
  await run('14-ai-error-toast', lang, 'provider-error', async (t) => {
    const { page, check, shot, context } = t;
    await metaWithAi(context, { draft: true, answers: true });
    await editorPage(t);
    const rail = page.getByRole('button', { name: m(lang, 'editor_showrail') });
    await rail.click();
    await page.getByRole('tab', { name: m(lang, 'editor_ai') }).click();
    const editor = page.locator('.ProseMirror').first();
    const saves = [];
    const baseline = [];
    let afterClick = false;
    page.on('request', (request) => {
      if (['PATCH', 'PUT'].includes(request.method()) && /\/pages\//.test(request.url())) (afterClick ? saves : baseline).push({ url: request.url(), body: request.postData() });
    });
    // Idle window: anything the editor saves on its own after opening is not caused by AI.
    await page.waitForTimeout(6000);
    t.note('page saves while idle before any AI request', baseline.map((save) => ({ url: save.url, body: save.body?.slice(0, 300) })));
    const before = await editor.innerText();
    afterClick = true;
    // Real local API without a provider: the request must fail.
    const failed = page.waitForResponse((response) => response.request().method() === 'POST' && /\/api\/app\/projects\/[^/]+\/ai$/.test(new URL(response.url()).pathname));
    await page.getByRole('button', { name: m(lang, 'editor_ai_continue') }).click();
    const response = await failed;
    t.note('AI response from the local API', { status: response.status(), body: (await response.text()).slice(0, 200) });
    check('AI request failed', !response.ok(), response.status());
    await toast(page, m(lang, 'editor_ai_drafterror')).waitFor();
    t.note('toasts after the provider error', await toastTexts(page));
    check('translated draft error toast is shown', true, m(lang, 'editor_ai_drafterror'));
    await settle(page);
    await shot('provider-error-toast');
    await page.waitForTimeout(2500);
    check('editor content unchanged', (await editor.innerText()) === before);
    check('no page save was sent after the AI request', saves.length === 0, saves);
    // Rate limit, as the real API reports it.
    await context.route(/\/api\/app\/projects\/[^/]+\/ai$/, async (route) => {
      const real = await route.fetch();
      await route.fulfill({ response: real, status: 429, json: { error: { code: 'http:rate_limited', message: 'Daily AI limit reached.' } } });
    });
    await page.locator('[data-sonner-toast]').first().waitFor({ state: 'detached', timeout: 15000 });
    const limited = page.waitForResponse((response) => response.request().method() === 'POST' && /\/api\/app\/projects\/[^/]+\/ai$/.test(new URL(response.url()).pathname));
    await page.getByRole('button', { name: m(lang, 'editor_ai_continue') }).click();
    check('routed AI request answered 429', (await limited).status() === 429);
    await toast(page, m(lang, 'editor_ai_ratelimited')).waitFor();
    const shown = await toastTexts(page);
    t.note('toasts after the rate limit', shown);
    check('only the translated rate-limit toast is shown', shown.length === 1 && shown[0].includes(m(lang, 'editor_ai_ratelimited')), shown);
    await settle(page);
    await shot('rate-limit-toast');
    await page.waitForTimeout(2500);
    check('editor content still unchanged', (await editor.innerText()) === before);
    check('still no page save', saves.length === 0, saves);
  }, { needs: 'dashboard' });

  for (const provider of [false, true]) {
    await run('15-ai-hidden', lang, provider ? 'provider' : 'no-provider', async (t) => {
      const { page, check, shot, context } = t;
      if (provider) await metaWithAi(context, { draft: true, answers: true });
      const meta = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/public/meta');
      await editorPage(t);
      const metaBody = await (await meta).json().catch(() => null);
      t.note('/meta ai as seen by the browser', metaBody?.data?.ai);
      if (!provider) check('local API reports no AI provider', metaBody?.data?.ai?.draft === false && metaBody?.data?.ai?.answers === false, metaBody?.data?.ai);
      const label = m(lang, provider ? 'editor_showrail' : 'editor_showcomments');
      await page.getByRole('button', { name: label }).click();
      check(`rail toggle reads "${label}"`, true);
      const aiTab = page.getByRole('tab', { name: m(lang, 'editor_ai') });
      await page.waitForTimeout(800);
      check(provider ? 'AI drafting tab is shown' : 'AI drafting tab is hidden', (await aiTab.count()) === (provider ? 1 : 0));
      await shot('editor-rail');
      await page.goto(`${APP}/app/projects/${demoProjectId}/settings?section=search`, { waitUntil: 'networkidle' });
      await page.locator('form').first().waitFor();
      await page.waitForTimeout(1500);
      const answers = page.getByText(m(lang, 'settings_search_aianswers_label'), { exact: true });
      check(provider ? 'AI answers setting is shown' : 'AI answers setting is hidden', (await answers.count()) === (provider ? 1 : 0));
      await shot('search-settings', undefined, { fullPage: true });
    }, { needs: 'dashboard' });
  }

  for (const device of ['desktop', 'mobile']) {
    await run('16-project-icon', lang, device, async (t) => {
      const { page, check, shot, context } = t;
      const created = await apiJson(context, 'POST', '/api/app/projects', { name: `Icon ${lang} ${device} ${Date.now() % 100000}` });
      const projectId = created.json?.data?.id;
      check('test project created through the local API', projectId, created);
      t.note('icon right after creation', created.json.data.icon ?? null);
      if (created.json.data.icon != null) {
        const cleared = await apiJson(context, 'PATCH', `/api/app/projects/${projectId}`, { icon: null });
        t.note('server assigned an icon at creation; cleared it through the API first', cleared.status);
      }
      const patches = [];
      page.on('request', (request) => {
        if (request.method() === 'PATCH' && new RegExp(`/api/app/projects/${projectId}$`).test(new URL(request.url()).pathname)) patches.push(request.postDataJSON());
      });
      const stored = async () => (await apiJson(context, 'GET', `/api/app/projects/${projectId}`)).json?.data?.icon ?? null;
      const save = async () => {
        const done = page.waitForResponse((response) => response.request().method() === 'PATCH' && new URL(response.url()).pathname === `/api/app/projects/${projectId}`);
        await page.getByRole('button', { name: m(lang, 'common_save') }).click();
        const response = await done;
        check('save request succeeds', response.ok(), response.status());
        await toast(page, m(lang, 'common_saved')).waitFor();
      };
      await page.goto(`${APP}/app/projects/${projectId}/settings?section=general`, { waitUntil: 'networkidle' });
      const noIcon = m(lang, 'settings_general_noicon');
      await page.locator(`[aria-label="${noIcon}"]`).first().waitFor();
      check('icon preview shows the translated "No icon" label', true, noIcon);
      // 1. Save another change without touching the icon.
      await page.locator('#set-desc').fill(`Saved without an icon (${lang})`);
      await save();
      check('saving without choosing an icon sends icon: null', patches.at(-1) && 'icon' in patches.at(-1) && patches.at(-1).icon === null, patches.at(-1));
      check('no icon is stored', (await stored()) === null);
      // 2. Pick an icon, then clear it.
      await page.getByRole('button', { name: m(lang, 'settings_general_changeicon') }).click();
      const picker = page.locator(`button[aria-label="${noIcon}"]`).locator('xpath=..');
      check('"No icon" choice is offered first and pressed', (await page.locator(`button[aria-label="${noIcon}"]`).getAttribute('aria-pressed')) === 'true');
      check('"No icon" title is translated', (await page.locator(`button[aria-label="${noIcon}"]`).getAttribute('title')) === noIcon);
      await shot('picker', picker);
      const emoji = picker.locator('button').nth(1);
      const chosen = (await emoji.textContent()).trim();
      await emoji.click();
      await save();
      check('choosing an icon stores it', patches.at(-1)?.icon === chosen && (await stored()) === chosen, { sent: patches.at(-1)?.icon, chosen });
      await page.getByRole('button', { name: m(lang, 'settings_general_changeicon') }).click();
      await page.locator(`button[aria-label="${noIcon}"]`).click();
      await save();
      check('clearing the icon sends icon: null', patches.at(-1) && 'icon' in patches.at(-1) && patches.at(-1).icon === null, patches.at(-1));
      check('cleared icon is stored as null', (await stored()) === null);
      await shot('after-clear', undefined, { fullPage: device === 'mobile' });
    }, { device, needs: 'dashboard' });
  }
}

// ─── Row 17: the sidebar under client-side navigation (#237 with #262) ──────
// Before #237 every sidebar click loaded a new document, so a branch only ever
// opened from server state. Here the document survives, so the current page
// changing in place is the only thing that can open a branch.

const expandedPaths = async (nav) => (await branchState(nav)).filter((branch) => branch.expanded === 'true').map((branch) => branch.path).sort();
const currentPaths = (nav) => nav.locator('a[aria-current="page"]').evaluateAll((links) => links.map((link) => new URL(link.href).pathname.split('/').slice(3).join('/')));
const arrivedAt = async (page, nav, path) => {
  await page.waitForFunction((tail) => location.pathname.endsWith(`/${tail}`), path);
  await nav.locator(`a[aria-current="page"][href*="/${path}"]`).first().waitFor({ state: 'attached' });
};
const keptLanguage = (page, lang) =>
  page.evaluate(
    (code) => document.documentElement.lang === code && document.documentElement.dir === (code === 'ar' ? 'rtl' : 'ltr') && (code !== 'ar' || location.search.includes('lang=ar')),
    lang,
  );

for (const lang of LANGS) {
  for (const [theme, project] of Object.entries(THEMES)) {
    await run('17-client-nav-sidebar', lang, theme, async (t) => {
      const { page, check, shot } = t;
      await openReader(t, project, 'getting-started/introduction', lang);
      const nav = await readerNav(t);
      await markDocument(page);
      check('starts with every page branch collapsed', (await expandedPaths(nav)).length === 0, await expandedPaths(nav));

      await nav.locator('a[href*="/guides/webhooks"]').first().click();
      await arrivedAt(page, nav, 'guides/webhooks');
      check('parent link stayed in the document', await sameDocument(page));
      check('parent link opened its own branch', (await expandedPaths(nav)).join() === 'guides/webhooks', await expandedPaths(nav));

      const child = nav.locator('a[href*="/guides/webhook-retries"]');
      check('its subpage is now visible', await child.isVisible());
      await child.click();
      await arrivedAt(page, nav, 'guides/webhook-retries');
      await page.locator('main h1').filter({ hasText: TITLES.retries[lang] }).waitFor();
      check('subpage link stayed in the document', await sameDocument(page));
      check('highlight moved to the subpage', (await currentPaths(nav)).join() === 'guides/webhook-retries', await currentPaths(nav));
      check('branch stayed open on the subpage', (await expandedPaths(nav)).join() === 'guides/webhooks', await expandedPaths(nav));
      await shot('subpage');

      // A reader can close the branch they are in, and nothing reopens it behind them.
      await toggleFor(nav, 'guides/webhooks').click();
      await page.waitForTimeout(1500);
      check('branch holding the current page stays collapsed by hand', (await expandedPaths(nav)).length === 0, await expandedPaths(nav));
      await nav.locator('a[href*="/guides/authentication"]').first().click();
      await arrivedAt(page, nav, 'guides/authentication');
      check('moving on leaves it collapsed and opens the new branch', (await expandedPaths(nav)).join() === 'guides/authentication', await expandedPaths(nav));

      // Search lands two levels down, with no sidebar click to open the way.
      await page.keyboard.press('Control+k');
      await page.locator('input[data-slot="command-input"]').fill('PKCE');
      await page.getByRole('option').filter({ hasText: TITLES.pkce[lang] }).first().click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await arrivedAt(page, nav, 'guides/auth-oauth-pkce');
      check('search stayed in the document', await sameDocument(page));
      check('both ancestors of the search result opened', (await expandedPaths(nav)).join() === 'guides/auth-oauth,guides/authentication', await expandedPaths(nav));
      check('search result is highlighted and visible', await nav.locator('a[aria-current="page"]').isVisible());
      check('search kept the language', await keptLanguage(page, lang), page.url());
      await shot('search-result');

      await page.goBack();
      await arrivedAt(page, nav, 'guides/authentication');
      await page.goBack();
      await arrivedAt(page, nav, 'guides/webhook-retries');
      check('back stayed in the document', await sameDocument(page));
      check('back reopened the branch holding the page', (await expandedPaths(nav)).join() === 'guides/auth-oauth,guides/authentication,guides/webhooks', await expandedPaths(nav));
      check('highlight followed back', (await currentPaths(nav)).join() === 'guides/webhook-retries', await currentPaths(nav));
      check('back kept the language', await keptLanguage(page, lang), page.url());

      await page.reload({ waitUntil: 'networkidle' });
      const fresh = await readerNav(t);
      check('after a reload only the branch holding the page is open', (await expandedPaths(fresh)).join() === 'guides/webhooks', await expandedPaths(fresh));
    }, { needs: 'reader' });
  }

  for (const theme of ['harbor', 'signal']) {
    await run('17-client-nav-sidebar', lang, theme, async (t) => {
      const { page, check, shot } = t;
      await openReader(t, THEMES[theme], 'getting-started/introduction', lang);
      let nav = await readerNav(t);
      await markDocument(page);
      await nav.locator('a[href*="/guides/webhooks"]').first().click();
      await page.waitForFunction(() => location.pathname.endsWith('/guides/webhooks'));
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      check('following a link closed the drawer and stayed in the document', await sameDocument(page));
      nav = await readerNav(t);
      check('reopened drawer shows the branch open', (await expandedPaths(nav)).join() === 'guides/webhooks', await expandedPaths(nav));
      await nav.locator('a[href*="/guides/webhook-retries"]').click();
      await page.waitForFunction(() => location.pathname.endsWith('/guides/webhook-retries'));
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      check('subpage link closed the drawer and stayed in the document', await sameDocument(page));
      nav = await readerNav(t);
      check('highlight moved to the subpage', (await currentPaths(nav)).join() === 'guides/webhook-retries', await currentPaths(nav));
      check('branch stayed open on the subpage', (await expandedPaths(nav)).join() === 'guides/webhooks', await expandedPaths(nav));
      await shot('reopened', page.getByRole('dialog'));
    }, { device: 'mobile', needs: 'reader' });
  }
}

await browser.close();

// ─── Report ──────────────────────────────────────────────────────────────────

const rows = {};
for (const result of results) {
  const entry = (rows[result.row] ??= { en: [], ar: [] });
  entry[result.lang].push(result.status);
}
const summarize = (statuses) => (statuses.length === 0 ? 'not run' : statuses.includes('fail') ? 'fail' : statuses.every((s) => s === 'not run') ? 'not run' : statuses.includes('not run') ? 'partial' : 'pass');
const summary = Object.fromEntries(Object.entries(rows).map(([row, { en, ar }]) => [row, { en: summarize(en), ar: summarize(ar), cases: en.length + ar.length }]));
await writeFile(`${out}/report.json`, JSON.stringify({ revision: process.env.GITHUB_SHA, readerUp, apiUp, summary, results }, null, 2));
console.table(summary);
