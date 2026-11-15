// Isolated component fixture of Site settings → Add-ons and → Visibility &
// access (allowed email domains, JWT handoff): the real screens (before: the
// main-branch form components; after: this branch) with the real design system
// and EN/AR catalogs, given a fictional site. The API is answered by
// interception and every request is recorded. Site access is fixed to Admin.
// Keys are trusted CDP key events in headless Chromium, so the browser's own
// implicit submission runs. Not the signed-in dashboard and not production.
// No server starts.
//
//   node .github/assets/settings-enter-remaining/capture.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { hostKey, withLocalOnlyBrowser } from '../../../tests/integration/lib/capture-env.mjs';
import { writeEvidenceJson } from '../../../tests/integration/lib/evidence-json.mjs';

const root = resolve(import.meta.dirname, '../../..');
const app = resolve(root, 'apps/app');
const out = import.meta.dirname;
const require = createRequire(resolve(app, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(require.resolve(name)).href);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const baseline = git('merge-base', 'HEAD', 'origin/main');
/** The form components this change touches; the "before" build uses main's copies, their relative imports made absolute. */
const swapped = [
  'apps/app/src/features/addons/components/addon-settings-form.tsx',
  'apps/app/src/features/reader-access/components/readers-section.tsx',
  'apps/app/src/features/reader-access/components/advanced-access.tsx',
];
const beforeSource = (path) => {
  const feature = path.match(/features\/([^/]+)\//)?.[1];
  return git('show', `${baseline}:${path}`)
    .replaceAll("from './", `from '@/features/${feature}/components/`)
    .replaceAll("from '../", `from '@/features/${feature}/`);
};
const catalogs = {
  en: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/en.json'), 'utf8')),
  ar: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/ar.json'), 'utf8')),
};
const msg = (locale, key) => catalogs[locale][key.replaceAll('.', '_').toLowerCase()];
const origin = 'http://settings.fixture.test';

// The fictional site: three add-ons with settings, and an Invited readers site with JWT handoff on (example.com hosts only, no keys).
const projectId = 'site-fieldnotes';
const availability = {
  state: 'available',
  plans: ['free'],
  available: true,
  schemaVersion: 1,
  projectId,
  availability: 'complete',
  decision: 'enabled',
  planKey: 'free',
  source: 'plan',
  limit: null,
  meterKey: null,
  behavior: 'observe',
  enforcement: 'advisory',
};
const addon = (id, group, config, revision) => ({
  id,
  group,
  enabled: true,
  config,
  revision,
  updatedAt: null,
  status: 'active',
  availability: { ...availability, entitlement: `addons.${id}`, capabilityKey: `addons.${id}` },
});
const addons = [
  addon('feedback', 'engagement', { placement: 'after-content', presentation: 'card' }, 3),
  addon('edit-suggestions', 'engagement', {}, 2),
  addon('consent-banner', 'privacy', { placement: 'bottom-end', presentation: 'comfortable', buttonLayout: 'inline' }, 1),
];
const readerAccess = {
  accessMode: 'READERS',
  readerEmailDomains: [],
  readerAccessRequests: false,
  accessRequests: [],
  readers: [],
  audiences: [],
  jwt: {
    enabled: true,
    issuer: 'https://portal.example.com',
    audience: 'fieldnotes-handbook',
    jwksUrl: 'https://portal.example.com/.well-known/jwks.json',
    publicJwks: null,
    groupsClaim: 'groups',
    claimMapping: {},
    sessionTtlMinutes: 480,
    maxTokenAgeSeconds: 300,
    clockToleranceSecs: 30,
  },
  audit: [],
};

/** The fixture API: reads answer from the fictional site; writes merge into it after `delay` ms. */
function fixtureApi() {
  const state = { addons: structuredClone(addons), reader: structuredClone(readerAccess) };
  const base = `/api/app/projects/${projectId}`;
  return (method, path, body) => {
    if (method === 'GET' && path === `${base}/addons`) return state.addons;
    if (method === 'GET' && path === `${base}/reader-access`) return state.reader;
    if (method === 'GET' && path === `${base}/pages`) return [];
    const addonId = path.match(/\/addons\/([^/]+)$/)?.[1];
    if (method === 'PATCH' && addonId) {
      const saved = state.addons.find((item) => item.id === addonId);
      return Object.assign(saved, { config: body.config, revision: saved.revision + 1 });
    }
    if (method === 'PUT' && path === `${base}/reader-access/domains`) {
      state.reader.readerEmailDomains = body.domains;
      return { domains: body.domains };
    }
    if (method === 'PUT' && path === `${base}/reader-access/jwt`) return Object.assign(state.reader.jwt, body);
  };
}

let harness;
try {
  harness = await mkdtemp(resolve(app, '.enter-remaining-capture-'));
  await mkdir(resolve(harness, 'before'));
  for (const path of swapped) await writeFile(resolve(harness, 'before', path.split('/').at(-1)), `${beforeSource(path)}\n`);
  await writeFile(
    resolve(harness, 'admin-status.ts'),
    "export const useProjectAdminStatus = () => ({ status: 'admin', edit: 'edit', role: 'ADMIN', isError: false, retrying: false, retry: () => undefined });\n",
  );
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    [
      '@import "@nibleaf/design-system/globals.css";',
      '@source "./";',
      '@source "../src/features/addons";',
      '@source "../src/features/reader-access";',
      '@source "../src/components";',
      '@source "../src/lib/forms";',
      '',
    ].join('\n'),
  );
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { DirectionProvider } from '@nibleaf/design-system/components/ui/direction';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { createRoot } from 'react-dom/client';
import { ConfigDirtyProvider } from '@/components/project-settings/shared';
import { AddonsSettings } from '@/features/addons/components/addons-settings';
import { ReaderAccessSettings } from '@/features/reader-access/components/reader-access-settings';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.classList.add('light');
const dirty = new Set<string>();
(window as unknown as { __dirty: () => string[] }).__dirty = () => [...dirty].sort();
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
const project = { id: ${JSON.stringify(projectId)} };
const Screen = params.get('screen') === 'readers' ? () => <ReaderAccessSettings project={project as never} /> : () => <AddonsSettings projectId={project.id} />;
const router = createRouter({
  history: createMemoryHistory({ initialEntries: ['/'] }),
  routeTree: createRootRoute({
    component: () => (
      <ConfigDirtyProvider report={(source, changed) => (changed ? dirty.add(source) : dirty.delete(source))}>
        <main className="mx-auto flex w-full max-w-4xl flex-col p-4 pb-24 text-foreground sm:p-8"><Screen /></main>
      </ConfigDirtyProvider>
    ),
  }),
});
createRoot(document.getElementById('root')!).render(
  <DirectionProvider direction={locale === 'ar' ? 'rtl' : 'ltr'}>
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
    <Toaster position={locale === 'ar' ? 'bottom-left' : 'bottom-right'} richColors />
  </DirectionProvider>,
);
`,
  );

  const { build } = await fromApp('vite');
  const react = (await fromApp('@vitejs/plugin-react')).default;
  const tailwind = (await fromApp('@tailwindcss/vite')).default;
  const dist = (phase) => resolve(harness, `dist-${phase}`);
  for (const phase of ['before', 'after']) {
    await build({
      configFile: false,
      root: harness,
      logLevel: 'error',
      define: { 'import.meta.env.VITE_SITE_BASE_DOMAIN': JSON.stringify('nibleaf.app') },
      resolve: { alias: [{ find: /^@\//, replacement: `${resolve(app, 'src')}/` }] },
      plugins: [
        {
          name: 'fixture-substitutes',
          enforce: 'pre',
          resolveId: (source, importer) => {
            // Matched after the `@/` alias too, so compare where the import points.
            const target = (source.startsWith('.') && importer ? resolve(importer, '..', source) : source).replaceAll('\\', '/');
            // Without TanStack Start's plugin the isomorphic API origin keeps its server branch; the browser only takes the client one.
            if (/\/src\/services\/api-origin(\.ts)?$/.test(target)) return '\0client-api-origin';
            // Site access comes from the members list and the session; the fixture is an Admin.
            if (/\/src\/hooks\/use-project-admin-status(\.ts)?$/.test(target)) return resolve(harness, 'admin-status.ts');
            if (phase === 'before') {
              const name = swapped
                .map((path) => path.split('/').at(-1).replace('.tsx', ''))
                .find((file) => target.endsWith(`/components/${file}`) || target.endsWith(`/components/${file}.tsx`));
              if (name) return resolve(harness, 'before', `${name}.tsx`);
            }
          },
          load: (id) => (id === '\0client-api-origin' ? 'export const apiOrigin = () => window.location.origin;' : undefined),
        },
        react(),
        tailwind(),
      ],
      build: { outDir: dist(phase), target: 'esnext' },
    });
  }
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };

  /** A page of the fixture. Navigating it (`go`) keeps the API state and the request log. */
  async function open(context, phase, server = {}) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const unanswered = [];
    const answer = fixtureApi();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      if (pathname.startsWith('/api/')) {
        const method = request.method();
        const body = request.postDataJSON();
        requests.push(body === null ? { method, path: pathname } : { method, path: pathname, body });
        if (method !== 'GET') await new Promise((done) => setTimeout(done, server.delay ?? 0));
        const data = answer(method, pathname, body);
        if (data === undefined) {
          unanswered.push(`${method} ${pathname}`);
          await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { message: 'fixture' } }) });
          return;
        }
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data }) });
        return;
      }
      const file = resolve(dist(phase), pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist(phase)}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    const go = async (screen, locale) => {
      await page.goto(`${origin}/?screen=${screen}&locale=${locale}`);
      await page
        .locator('form input')
        .first()
        .waitFor({ timeout: 20_000 })
        .catch((error) => {
          throw new Error(`${screen} ${phase} ${locale} did not render: ${JSON.stringify({ errors, unanswered, requests })}`, { cause: error });
        });
      await page.evaluate(() => document.fonts.ready);
    };
    return { page, go, errors, requests, unanswered };
  }

  const writes = (requests) => requests.filter((request) => request.method !== 'GET');
  const field = (page, locale, key) => page.getByLabel(msg(locale, key), { exact: true });
  const openAdvanced = (page, locale) => page.getByRole('button', { name: msg(locale, 'settings.visibility.advanced.title') }).click();
  /** What a reviewer should see after a step: dirty sources, the bar, its live status, the dialog, toasts, focus and the writes so far. */
  const readback = async (page, requests) => ({
    dirtySources: await page.evaluate(() => window.__dirty()),
    saveBarShown: await page.locator('[data-slot="save-region"]').isVisible(),
    // The SaveRegion's polite status stays mounted after the bar hides.
    status: await page.evaluate(() => [...document.querySelectorAll('div[role="status"][aria-live="polite"].sr-only')].at(-1)?.textContent ?? ''),
    confirmationOpen: await page.locator('[data-slot="action-dialog"]').first().isVisible(),
    toasts: await page.locator('[data-sonner-toast]').allTextContents(),
    focused: await page.evaluate(() => {
      const active = document.activeElement;
      if (!active || active === document.body) return 'body';
      return `${active.tagName.toLowerCase()}${active.getAttribute('aria-invalid') === 'true' ? '[aria-invalid]' : ''}`;
    }),
    writes: writes(requests),
  });
  const settle = (page, ms = 500) => page.waitForTimeout(ms);
  /** Prints the readback on the capture itself (fixture only), so the image says what Enter did. */
  const caption = (page, text) =>
    page.evaluate((value) => {
      const note = document.createElement('div');
      note.textContent = value;
      note.setAttribute(
        'style',
        'position:fixed;top:0;inset-inline:0;z-index:2147483647;background:#111;color:#fff;font:12px/1.4 ui-monospace,monospace;padding:4px 8px;direction:ltr;text-align:left',
      );
      document.body.append(note);
    }, text);

  const captures = [];
  let recording;
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    // The reproduction, one per form family: edit a single-line field, press Enter, read back what was sent and what was said.
    const scenes = [
      {
        family: 'addons',
        screen: 'addons',
        locale: 'en',
        width: 1440,
        key: 'settings.addons.editUrl.label',
        text: 'https://github.com/fieldnotes/handbook/edit/main/{path}',
      },
      { family: 'email-domains', screen: 'readers', locale: 'ar', width: 390, key: 'settings.visibility.domains.label', text: 'fieldnotes.example' },
      {
        family: 'jwt',
        screen: 'readers',
        locale: 'en',
        width: 390,
        key: 'settings.visibility.jwt.audience',
        text: 'fieldnotes-handbook-v2',
        advanced: true,
      },
      {
        family: 'jwt',
        screen: 'readers',
        locale: 'ar',
        width: 1440,
        key: 'settings.visibility.jwt.audience',
        text: 'fieldnotes-handbook-v2',
        advanced: true,
      },
    ];
    for (const scene of scenes)
      for (const phase of ['before', 'after']) {
        const context = await browser.newContext({ viewport: { width: scene.width, height: 900 }, reducedMotion: 'reduce' });
        const { page, go, errors, requests, unanswered } = await open(context, phase);
        await go(scene.screen, scene.locale);
        if (scene.advanced) await openAdvanced(page, scene.locale);
        const input = field(page, scene.locale, scene.key);
        await input.click();
        await input.fill(scene.text);
        await page.waitForFunction(() => window.__dirty().length > 0, null, { timeout: 3000 });
        await page.keyboard.press('Enter');
        await settle(page);
        const afterEnter = await readback(page, requests);
        const saved = msg(scene.locale, 'common.saved');
        const file = `enter-${scene.family}-${phase}-${scene.locale}-${scene.width}.png`;
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        const dir = await page.evaluate(() => document.documentElement.dir);
        await caption(
          page,
          `fixture · ${phase} · Enter → ${afterEnter.writes.map((w) => `${w.method} ${w.path.split('/').slice(-2).join('/')}`).join(', ') || 'no write'} · status "${afterEnter.status}" · confirmation ${afterEnter.confirmationOpen ? 'open' : 'closed'}`,
        );
        await page.mouse.move(0, 0);
        await page.screenshot({ path: resolve(out, file), animations: 'disabled' });
        await context.close();
        assert.deepEqual(errors, [], file);
        assert.deepEqual(unanswered, [], file);
        assert.equal(overflow, false, file);
        assert.equal(dir, scene.locale === 'ar' ? 'rtl' : 'ltr', file);
        if (phase === 'before') assert.notEqual(afterEnter.status, saved, `${file}: main never says "Saved" on Enter`);
        if (phase === 'after') {
          if (scene.family === 'jwt') {
            // Enter asks first: no write and no "Saved" before the person confirms.
            assert.equal(afterEnter.confirmationOpen, true, file);
            assert.deepEqual(afterEnter.writes, [], file);
            assert.equal(afterEnter.status, '', file);
          } else {
            assert.equal(afterEnter.writes.length, 1, file);
            assert.equal(afterEnter.status, saved, file);
            assert.deepEqual(afterEnter.dirtySources, [], file);
          }
        }
        captures.push({ file, ...scene, phase, dir, overflow, afterEnter });
      }

    // One keyboard recording on this branch across the three form families, with a slow server.
    const file = 'flow-after-en-1440.webm';
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: 'reduce',
      recordVideo: { dir: harness, size: { width: 1152, height: 720 } },
    });
    const { page, go, errors, requests, unanswered } = await open(context, 'after', { delay: 700 });
    const steps = [];
    const note = async (step) => steps.push({ step, ...(await readback(page, requests)) });
    await go('addons', 'en');
    const template = field(page, 'en', 'settings.addons.editUrl.label');
    await template.click();
    await page.keyboard.type('https://github.com/fieldnotes/handbook/edit/main/{path}', { delay: 25 });
    await page.keyboard.press('Shift+Enter');
    await settle(page, 300);
    await note('Add-ons: typed an edit link, Shift+Enter: nothing sent');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await settle(page, 1200);
    await note('Add-ons: Enter twice: one write for this add-on, then "Saved"');
    await page.keyboard.press('Enter');
    await settle(page, 300);
    await note('Add-ons: Enter in the clean form: nothing sent');

    await go('readers', 'en');
    const domains = field(page, 'en', 'settings.visibility.domains.label');
    await domains.click();
    await page.keyboard.type('fieldnotes.example', { delay: 40 });
    await page.keyboard.press('Enter');
    await settle(page, 1200);
    await note('Allowed domains: Enter saves the domain, then "Saved"');

    await openAdvanced(page, 'en');
    const audience = field(page, 'en', 'settings.visibility.jwt.audience');
    await audience.click();
    await page.keyboard.press('End');
    await page.keyboard.type('-v2', { delay: 60 });
    await page.keyboard.press('Enter');
    await settle(page);
    await note('JWT: Enter opens the confirmation; nothing sent, nothing said');
    await page.keyboard.press('Escape');
    await settle(page);
    await note('JWT: Escape cancels; the edit stays and the bar stays up');
    await audience.focus();
    await page.keyboard.press('Enter');
    await settle(page);
    await page.locator('[data-slot="action-dialog"] button[type="submit"]').focus();
    await page.keyboard.press('Enter');
    await settle(page, 1300);
    await note('JWT: Enter again, then Enter on Save in the confirmation: one write and the saved toast');
    const video = page.video();
    await context.close();
    await video.saveAs(resolve(out, file));
    assert.deepEqual(errors, []);
    assert.deepEqual(unanswered, []);
    const [shifted, twice, clean, domainSaved, asked, cancelled, confirmed] = steps;
    assert.deepEqual(shifted.writes, []);
    assert.equal(twice.writes.length, 1);
    assert.equal(twice.writes[0].path, `/api/app/projects/${projectId}/addons/edit-suggestions`);
    assert.equal(twice.status, msg('en', 'common.saved'));
    assert.equal(clean.writes.length, 1);
    assert.equal(writes(requests).filter((w) => w.path.endsWith('/reader-access/domains')).length, 1);
    assert.deepEqual(domainSaved.dirtySources, []);
    assert.equal(asked.confirmationOpen, true);
    assert.equal(asked.writes.length, 2);
    assert.equal(cancelled.confirmationOpen, false);
    assert.equal(cancelled.saveBarShown, true);
    assert.equal(cancelled.writes.length, 2);
    assert.equal(confirmed.writes.length, 3);
    assert.equal(confirmed.writes[2].body.audience, 'fieldnotes-handbook-v2');
    assert.ok(confirmed.toasts.includes(msg('en', 'settings.authentication.reader.jwtSaved')), JSON.stringify(confirmed.toasts));
    assert.equal(confirmed.saveBarShown, false);
    recording = { file, locale: 'en', width: 1440, steps, pageErrors: errors };

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(out, 'evidence.json'), {
      environment:
        'Component fixture: the real Add-ons and Visibility & access settings screens (before: main’s form components; after: this branch) with the real design system and EN/AR catalogs; fictional site; API answered by interception, every request recorded; site access fixed to Admin; trusted CDP key events in headless Chromium; not the signed-in dashboard or production; no screen reader was run',
      baseline,
      head: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain', '--', 'apps/app/src').split('\n').filter(Boolean),
      swappedForBefore: swapped,
      attempted: attempted.length,
      captures,
      recording,
    });
  });
  console.log(`${captures.length} captures, 1 recording`);
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    await rm(harness, { recursive: true, force: true });
  }
}
