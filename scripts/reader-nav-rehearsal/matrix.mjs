import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const { chromium } = await import(process.env.BROWSER_MODULE);
const out = 'output/reader-nav';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ args: ['--host-resolver-rules=MAP docs.reader.test 127.0.0.1', '--no-proxy-server'] });
const results = [];
const base = 'http://localhost:4310/sites/preview-harbor';
const slug = 'reference/البداية';
const home = 'getting-started/introduction';
const title = { en: 'Matrix English', ar: 'مصفوفة عربية' };
const description = { en: 'English navigation fixture.', ar: 'صفحة اختبار التنقل العربية.' };
const href = (path, lang, origin = base) => `${origin}/${path}${lang === 'ar' ? '?lang=ar' : ''}`;
const wait = async (page, predicate, arg) => page.waitForFunction(predicate, arg, { timeout: 15000 });
const mark = page => page.evaluate(() => { window.__readerDocument = 'original'; });
const retained = async page => assert.equal(await page.evaluate(() => window.__readerDocument), 'original', 'navigation loaded a new document');
const heading = async (page, text) => {
  await page.locator('main h1').filter({ hasText: text }).waitFor();
};
const sidebar = (page, path) => page.locator('[data-theme-region="sidebar"] a').filter({ visible: true }).and(page.locator(`a[href*="${encodeURI(path)}"], a[href*="${path}"]`)).first();
const openSearch = async page => {
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog').waitFor();
  await page.getByRole('combobox').fill('');
};
const searchTo = async (page, lang) => {
  await openSearch(page);
  await page.getByRole('combobox').fill(title[lang]);
  await page.getByRole('option').filter({ hasText: title[lang] }).first().click();
  await heading(page, title[lang]);
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
};

// Wait for the actual hosted reader, without relying on a fixed startup delay.
let available = false;
for (let attempt = 0; attempt < 90; attempt++) {
  try { available = (await fetch(`${base}/${home}`, { signal: AbortSignal.timeout(5000) })).ok; } catch {}
  if (available) break;
  await new Promise(resolve => setTimeout(resolve, 1000));
}

async function row(lang, name, action, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  // Mock-only rehearsal: do not contact fonts, social sites, or other external services.
  await context.route('**/*', route => /^(localhost|127\.0\.0\.1|docs\.reader\.test)$/.test(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const errors = [];
  const documents = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url()); });
  const result = { language: lang, row: name, status: 'fail', documents, errors };
  try {
    assert.ok(available, 'reader did not become available');
    await page.goto(href(home, lang), { waitUntil: 'networkidle' });
    await page.locator('main h1').waitFor();
    await mark(page);
    await action(page, context, result);
    result.status = 'pass';
  } catch (error) {
    if (!available) result.status = 'not-verified';
    result.reason = error.message;
  } finally {
    result.url = page.url();
    result.activeElement = await page.evaluate(() => ({ tag: document.activeElement?.tagName, text: document.activeElement?.textContent?.slice(0, 120) })).catch(() => null);
    await page.screenshot({ path: `${out}/${lang}-${name}.png`, fullPage: false }).catch(() => {});
    results.push(result);
    await writeFile(`${out}/${lang}-${name}.json`, JSON.stringify(result, null, 2));
    console.log(`${lang} ${name}: ${result.status}${result.reason ? ` (${result.reason.split('\n')[0]})` : ''}`);
    await context.close();
  }
}

for (const lang of ['en', 'ar']) {
  await row(lang, 'sidebar-arabic-slug', async page => {
    await sidebar(page, slug).click();
    await heading(page, title[lang]);
    assert.ok(decodeURI(new URL(page.url()).pathname).endsWith(slug));
    await retained(page);
  });
  await row(lang, 'cards', async page => {
    const previousHeading = await page.locator('main h1').textContent();
    await page.locator('main article a[href*="guides/webhooks"]').first().click();
    await wait(page, () => location.pathname.endsWith('/guides/webhooks'));
    await wait(page, previous => document.querySelector('main h1')?.textContent !== previous, previousHeading);
    await retained(page);
  });
  await row(lang, 'pager', async page => {
    const previousHeading = await page.locator('main h1').textContent();
    await page.locator('main article nav a').last().click();
    await wait(page, () => location.pathname.endsWith('/getting-started/installation'));
    await wait(page, previous => document.querySelector('main h1')?.textContent !== previous, previousHeading);
    await retained(page);
  });
  await row(lang, 'search', async page => {
    await searchTo(page, lang);
    await retained(page);
  });
  await row(lang, 'history-scroll', async page => {
    await page.evaluate(() => window.scrollTo(0, 650));
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => Math.round(window.scrollY)), 650);
    await sidebar(page, slug).click();
    await heading(page, title[lang]);
    await page.evaluate(() => window.scrollTo(0, 900));
    await page.waitForTimeout(250);
    await page.goBack();
    await wait(page, () => Math.abs(window.scrollY - 650) < 20);
    await page.goForward();
    await heading(page, title[lang]);
    await wait(page, () => Math.abs(window.scrollY - 900) < 20);
    await retained(page);
  });
  await row(lang, 'cross-page-fragment', async page => {
    await page.getByRole('link', { name: 'Matrix cross fragment', exact: true }).click();
    await heading(page, title[lang]);
    await wait(page, () => location.hash === '#matrix-end' && Math.abs(document.getElementById('matrix-end').getBoundingClientRect().top) < 200);
    await retained(page);
  });
  await row(lang, 'same-page-fragment', async page => {
    await page.getByRole('link', { name: 'Matrix same fragment', exact: true }).click();
    await wait(page, () => location.hash === '#matrix-end' && Math.abs(document.getElementById('matrix-end').getBoundingClientRect().top) < 200);
    await retained(page);
  });
  await row(lang, 'language-seo', async page => {
    const target = lang === 'en' ? 'ar' : 'en';
    const before = await page.locator('link[rel="canonical"]').getAttribute('href');
    // Identify the actual language control from its localized label in the DOM.
    await page.locator('button').filter({ has: page.locator('span[lang]') }).first().click();
    await page.getByRole('menuitem').filter({ hasText: target === 'ar' ? 'العربية' : 'English' }).click();
    await wait(page, code => document.documentElement.lang === code && document.documentElement.dir === (code === 'ar' ? 'rtl' : 'ltr'), target);
    await wait(page, old => document.querySelector('link[rel="canonical"]')?.href !== old, before);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
    assert.equal(new URL(canonical).searchParams.get('lang'), target === 'ar' ? 'ar' : null);
    const alternates = await page.locator('link[rel="alternate"][hreflang]').evaluateAll(nodes => nodes.map(node => ({ lang: node.hreflang, href: node.href })));
    assert.ok(alternates.some(item => item.lang === 'ar' && new URL(item.href).searchParams.get('lang') === 'ar'));
    assert.ok(alternates.some(item => item.lang === 'en' && new URL(item.href).searchParams.get('lang') === null));
    await retained(page);
  });
  await row(lang, 'version', async page => {
    await page.getByRole('button').filter({ hasText: 'Latest' }).click();
    await page.getByRole('menuitem').filter({ hasText: 'V2' }).click();
    await wait(page, () => location.pathname.includes('/v2/'));
    await page.getByRole('button').filter({ hasText: 'V2' }).waitFor();
    assert.equal(new URL(page.url()).searchParams.get('lang'), lang === 'ar' ? 'ar' : null);
    await retained(page);
  });
  await row(lang, 'changelog', async page => {
    const previousHeading = await page.locator('main h1').textContent();
    await page.locator('header a[href*="/changelog"]').first().click();
    await wait(page, () => location.pathname.endsWith('/changelog'));
    await wait(page, previous => document.querySelector('main h1')?.textContent !== previous, previousHeading);
    await retained(page);
  });
  await row(lang, 'mobile-menu', async page => {
    await page.locator('button[data-slot="sheet-trigger"]').click();
    await page.getByRole('dialog').waitFor();
    await page.getByRole('dialog').locator(`a[href*="${encodeURI(slug)}"]`).first().click();
    await heading(page, title[lang]);
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await retained(page);
  }, { viewport: { width: 390, height: 844 }, isMobile: true });
  await row(lang, 'custom-domain', async page => {
    await page.goto(href(home, lang, 'http://docs.reader.test:4310'), { waitUntil: 'networkidle' });
    await page.locator('main h1').waitFor();
    assert.equal(await page.locator('meta[name="nibleaf-site-project"]').getAttribute('content'), 'preview-harbor');
    await mark(page);
    await sidebar(page, slug).click();
    await heading(page, title[lang]);
    assert.equal(decodeURI(new URL(page.url()).pathname), `/${slug}`);
    assert.ok(!(await page.locator('link[rel="canonical"]').getAttribute('href')).includes('/sites/'));
    await retained(page);
  });
  await row(lang, 'title-meta', async page => {
    const oldTitle = await page.title();
    await sidebar(page, slug).click();
    await heading(page, title[lang]);
    await wait(page, expected => document.title.includes(expected), title[lang]);
    assert.notEqual(await page.title(), oldTitle);
    assert.equal(await page.locator('meta[name="description"]').getAttribute('content'), description[lang]);
    await retained(page);
  });
  await row(lang, 'navigation-focus', async page => {
    await sidebar(page, slug).focus();
    await page.keyboard.press('Enter');
    await heading(page, title[lang]);
    await wait(page, () => document.activeElement === document.querySelector('main h1'));
    assert.equal(await page.locator('main h1').getAttribute('tabindex'), '-1');
    await retained(page);
  });
  await row(lang, 'initial-focus', async page => {
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('main h1')), false);
  });
  await row(lang, 'dialog-focus', async page => {
    await searchTo(page, lang);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('main h1')), false, 'navigation stole dialog restoration focus');
    await retained(page);
  });
  await row(lang, 'javascript-disabled', async page => {
    await sidebar(page, slug).click();
    await heading(page, title[lang]);
    assert.ok(decodeURI(new URL(page.url()).pathname).endsWith(slug));
    assert.equal(await page.evaluate(() => window.__readerDocument), undefined, 'expected a new document without JS');
  }, { javaScriptEnabled: false });
}
await writeFile(`${out}/results.json`, JSON.stringify({ revision: process.env.GITHUB_SHA, results }, null, 2));
await browser.close();
process.exitCode = results.some(result => result.status === 'fail') ? 1 : 0;
