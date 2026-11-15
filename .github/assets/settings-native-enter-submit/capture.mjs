// Isolated component fixture of Site settings → General and → Search: the real
// screens (before: the main-branch components and save region; after: this
// branch) with the real design system and EN/AR catalogs, given a fictional
// site. The API is answered by interception and every request is recorded.
// Site access is fixed to Admin. Keys are trusted CDP key events in headless
// Chromium, so the browser's own implicit submission runs. Not the signed-in
// dashboard and not production. No server starts.
//
//   node .github/assets/settings-native-enter-submit/capture.mjs [--before-only]
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireDevstackLock, hostKey, withLocalOnlyBrowser } from '../../../tests/integration/lib/capture-env.mjs';
import { writeEvidenceJson } from '../../../tests/integration/lib/evidence-json.mjs';

const beforeOnly = process.argv.includes('--before-only');
const root = resolve(import.meta.dirname, '../../..');
const app = resolve(root, 'apps/app');
const out = import.meta.dirname;
const require = createRequire(resolve(app, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(require.resolve(name)).href);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const baseline = git('merge-base', 'HEAD', 'origin/main');
/** The main-branch files the "before" build uses, their relative imports made absolute. */
const beforeFiles = {
  'save-region.tsx': 'apps/app/src/lib/forms/save-region.tsx',
  'general-settings.tsx': 'apps/app/src/features/site-general/components/general-settings.tsx',
  'search-settings.tsx': 'apps/app/src/features/site-search/components/search-settings.tsx',
};
const beforeSource = (path) => {
  const feature = path.match(/features\/([^/]+)\//)?.[1];
  return git('show', `${baseline}:${path}`)
    .replaceAll("from '@/lib/forms/save-region'", "from './save-region'")
    .replaceAll("from '../", `from '@/features/${feature}/`)
    .replaceAll("from './index-health'", "from '@/features/site-search/components/index-health'");
};
const catalogs = {
  en: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/en.json'), 'utf8')),
  ar: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/ar.json'), 'utf8')),
};
const msg = (locale, key) => catalogs[locale][key.replaceAll('.', '_').toLowerCase()];
const origin = 'http://settings.fixture.test';

// The fictional site.
const projectId = 'site-fieldnotes';
const project = { id: projectId, name: 'Fieldnotes Handbook', slug: 'fieldnotes', description: 'How the Fieldnotes crew works.', icon: null };
const languages = [
  { id: 'lang-en', code: 'en', label: 'English', isDefault: true, position: 0, direction: 'LTR' },
  {
    id: 'lang-ar',
    code: 'ar',
    label: 'العربية',
    isDefault: false,
    position: 1,
    direction: 'RTL',
    translation: { name: 'دليل فيلدنوتس', description: '' },
  },
];
const configuration = {
  maxResults: 12,
  filtersEnabled: true,
  versionFilterEnabled: true,
  aiAnswers: false,
  aiProvider: 'instance',
  aiConversationCapture: true,
  aiStarterQuestions: ['How do I file a field note?'],
  hotkey: 'cmdk',
  placeholder: 'Search the handbook',
};
const constraints = { maxResults: { default: 12, min: 1, max: 50 } };
/** Where AI answers stand (read-only on this page) and a ready index, as the API shapes them. */
const siteAi = {
  capabilities: {
    managed: { available: true, reason: null, model: null, dailyAnswerLimit: 200 },
    ownKey: { available: true, reason: null },
    providers: [],
    answers: { available: true, reason: null },
  },
  status: {
    answersOn: false,
    source: 'managed',
    sourceReady: true,
    connections: [],
    published: { version: 3, at: null },
    preparation: { state: 'ready', pages: 14, expectedPages: 14, at: null },
    usage: { answersToday: 0, spent: 0, limit: 200, resetsAt: '2026-11-16T00:00:00.000Z' },
  },
  viewer: { canManage: true },
};
const diagnostics = {
  availability: { configured: true, reason: null },
  health: 'ready',
  runtime: 'hybrid',
  index: { logicalId: 'fieldnotes', schemaVersion: 'v3', revisionId: 'rev-1', deploymentVersion: 1, embeddingModel: 'embed-1', vectorSize: 3 },
  corpus: {
    chunks: 52,
    pages: 14,
    languages: [{ code: 'en', count: 52 }],
    versions: [{ slug: 'main', count: 52 }],
    distributionTruncated: { languages: false, versions: false },
  },
  latestRun: null,
  samples: { items: [], nextCursor: null, hasMore: false },
  issues: { staleCount: 0, failedCount: 0, items: [] },
};

const lock = await acquireDevstackLock('settings native Enter captures');
let harness;
try {
  harness = await mkdtemp(resolve(app, '.enter-submit-capture-'));
  await mkdir(resolve(harness, 'before'));
  for (const [name, path] of Object.entries(beforeFiles)) await writeFile(resolve(harness, 'before', name), `${beforeSource(path)}\n`);
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
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-general";\n@source "../src/features/site-search";\n@source "../src/components/project-settings";\n@source "../src/lib/forms";\n@source "../src/components/ui";\n',
  );
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigDirtyProvider } from '@/components/project-settings/shared';
import { GeneralSettings } from '@/features/site-general/components/general-settings';
import { SearchSettings } from '@/features/site-search/components/search-settings';
import * as regionAfter from '@/lib/forms/save-region';
import { useServerDraftForm } from '@/lib/forms/use-server-draft';
import { GeneralSettings as GeneralBefore } from './before/general-settings';
import { SearchSettings as SearchBefore } from './before/search-settings';

const params = new URLSearchParams(location.search);
await setLanguage(params.get('locale') === 'ar' ? 'ar' : 'en');
document.documentElement.classList.add('light');
const before = params.get('phase') === 'before';
const project = ${JSON.stringify(project)};
const dirty = new Set<string>();
(window as unknown as { __dirty: () => string[] }).__dirty = () => [...dirty].sort();
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

/** Two explicit-save forms under one SaveRegion, each with two single-line fields (fixture only). */
function PairForm({ id, label }: { id: string; label: string }) {
  const { form, ...draft } = useServerDraftForm<{ first: string; second: string }>({
    identity: [id],
    source: { first: label, second: '' },
    onSubmit: async (value, save) => {
      const response = await fetch('/api/fixture/' + id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
      if (!response.ok) return 'failed';
      save.succeeded(value);
      return 'saved';
    },
  });
  const submit = async () => {
    const outcome = await draft.submit();
    return outcome === 'busy' ? 'failed' : outcome;
  };
  const formProps = regionAfter.useSaveRegionForm(id, {
    isDirty: draft.isDirty,
    isSubmitting: draft.isSaving,
    submit,
    discard: draft.discard,
    settlement: draft.settlement,
  });
  return (
    <form aria-label={label} className="flex flex-col gap-2 rounded-xl border border-border p-4" noValidate {...formProps}>
      <regionAfter.SaveRegionSubmit />
      {(['first', 'second'] as const).map((name) => (
        <form.Field key={name} name={name}>
          {(field) => (
            <label className="flex flex-col gap-1 text-sm">
              {label} · {name}
              <Input name={id + '-' + name} onChange={(event) => field.handleChange(event.target.value)} value={field.state.value} />
            </label>
          )}
        </form.Field>
      ))}
    </form>
  );
}

const screens: Record<string, () => ReactNode> = {
  general: () => (before ? <GeneralBefore project={project as never} /> : <GeneralSettings project={project as never} />),
  search: () => (before ? <SearchBefore project={project as never} /> : <SearchSettings project={project as never} />),
  pair: () => (
    <regionAfter.SaveRegionProvider>
      <div className="flex flex-col gap-4">
        <PairForm id="form-a" label="Form A" />
        <PairForm id="form-b" label="Form B" />
      </div>
    </regionAfter.SaveRegionProvider>
  ),
};
const Screen = screens[params.get('screen') ?? 'general'];
const router = createRouter({
  history: createMemoryHistory({ initialEntries: ['/'] }),
  routeTree: createRootRoute({
    component: () => (
      <ConfigDirtyProvider report={(source, changed) => (changed ? dirty.add(source) : dirty.delete(source))}>
        <main className="mx-auto flex w-full max-w-4xl flex-col p-4 text-foreground sm:p-8"><Screen /></main>
      </ConfigDirtyProvider>
    ),
  }),
});
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
`,
  );
  const { build } = await fromApp('vite');
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
        },
        load: (id) => (id === '\0client-api-origin' ? 'export const apiOrigin = () => window.location.origin;' : undefined),
      },
      (await fromApp('@vitejs/plugin-react')).default(),
      (await fromApp('@tailwindcss/vite')).default(),
    ],
    build: { outDir: resolve(harness, 'dist'), target: 'esnext' },
  });
  const dist = resolve(harness, 'dist');
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };

  /** The fixture API: reads answer from the fictional site, writes merge into it after `delay` ms (or fail with `fail`). */
  function fixtureApi() {
    const state = { project: { ...project }, languages: structuredClone(languages), configuration: { ...configuration } };
    return (method, path, body) => {
      const base = `/api/app/projects/${projectId}`;
      if (method === 'GET' && path === `${base}/languages`) return state.languages;
      if (method === 'GET' && path === `${base}/settings/search`) return { configuration: state.configuration, constraints };
      if (method === 'GET' && path === `${base}/settings/search/diagnostics`) return diagnostics;
      if (method === 'GET' && path === `${base}/settings/ai`) return siteAi;
      if (method === 'PATCH' && path === base) return Object.assign(state.project, body);
      if (method === 'PATCH' && path.startsWith(`${base}/languages/`)) {
        const language = state.languages.find((item) => item.id === path.split('/').at(-1));
        Object.assign(language, body);
        return language;
      }
      if (method === 'PATCH' && path === `${base}/settings/search`) return { configuration: Object.assign(state.configuration, body), constraints };
      if (method === 'PATCH' && path.startsWith('/api/fixture/')) return body;
    };
  }

  async function open(context, { screen, phase, locale }, server = {}) {
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
        const data = server.fail && method !== 'GET' ? undefined : answer(method, pathname, body);
        if (data === undefined) {
          if (!server.fail) unanswered.push(`${method} ${pathname}`);
          await route.fulfill({
            status: server.fail ? 500 : 404,
            contentType: 'application/json',
            body: JSON.stringify({ error: { message: 'fixture' } }),
          });
          return;
        }
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data }) });
        return;
      }
      const file = resolve(dist, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?screen=${screen}&locale=${locale}&phase=${phase}`);
    await page
      .locator('form input')
      .first()
      .waitFor({ timeout: 20_000 })
      .catch((error) => {
        throw new Error(`${screen} ${phase} ${locale} did not render: ${JSON.stringify({ errors, unanswered, requests })}`, { cause: error });
      });
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests, unanswered };
  }

  const mutations = (requests) => requests.filter((request) => request.method !== 'GET');
  const field = (page, locale, key) => page.getByLabel(msg(locale, key), { exact: true });
  const saveBar = (page) => page.locator('[data-slot="save-region"]');
  /** What a reviewer should see after a step: dirty sources, the bar, the live status, focus and the writes so far. */
  const readback = async (page, requests) => ({
    dirtySources: await page.evaluate(() => window.__dirty()),
    saveBarShown: await saveBar(page).isVisible(),
    status: await page.evaluate(() => document.querySelector('[role="status"]')?.textContent ?? ''),
    focused: await page.evaluate(() => {
      const active = document.activeElement;
      return active && active !== document.body
        ? `${active.tagName.toLowerCase()}${active.getAttribute('aria-invalid') === 'true' ? '[aria-invalid]' : ''}`
        : 'body';
    }),
    mutations: mutations(requests),
  });
  const settle = (page, ms = 400) => page.waitForTimeout(ms);
  /** Every Tab stop on the page, in order, until focus comes back round. */
  const tabStops = async (page) => {
    await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
    const stops = [];
    for (let index = 0; index < 80; index += 1) {
      await page.keyboard.press('Tab');
      const stop = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        return `${el.tagName.toLowerCase()}${el.getAttribute('type') ? `[type=${el.getAttribute('type')}]` : ''}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}`;
      });
      if (stop === null || (stops.length > 0 && stop === stops[0] && index > 2)) break;
      stops.push(stop);
    }
    return stops;
  };
  /** Submit controls the accessibility tree exposes (the hidden default button must not be one of them). */
  const exposedSubmits = (page) =>
    page.evaluate(() => [...document.querySelectorAll('button[type="submit"]')].filter((button) => button.checkVisibility()).length);

  const captures = [];
  const behaviours = [];
  const recordings = [];
  /** One named check on a fresh page: `act` returns what it observed; `expect` asserts on it. */
  const check = async (browser, name, options, act, expect) => {
    const context = await browser.newContext({ viewport: { width: options.width ?? 1440, height: 900 }, reducedMotion: 'reduce' });
    const { page, errors, requests, unanswered } = await open(context, options, options.server);
    const observed = await act(page, requests);
    await context.close();
    const result = { name, screen: options.screen, phase: options.phase, locale: options.locale, ...observed, pageErrors: errors, unanswered };
    assert.deepEqual(errors, [], name);
    assert.deepEqual(unanswered, [], name);
    expect?.(result);
    behaviours.push(result);
    return result;
  };

  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    const phases = beforeOnly ? ['before'] : ['before', 'after'];
    // The reproduction: edit one single-line field, press Enter, read back what was sent and whether the form is still dirty.
    const enterScenes = {
      general: { key: 'settings.general.name.label', text: 'Fieldnotes Field Guide' },
      search: { key: 'settings.search.placeholder.label', text: 'Search the field guide' },
    };
    for (const [screen, scene] of Object.entries(enterScenes))
      for (const locale of ['en', 'ar'])
        for (const width of [1440, 390])
          for (const phase of phases) {
            const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
            const { page, errors, requests, unanswered } = await open(context, { screen, phase, locale });
            const input = field(page, locale, scene.key);
            await input.click();
            await input.fill(scene.text);
            // The bar registers the form from an effect; read back once it has.
            await page.waitForFunction(() => window.__dirty().length > 0, null, { timeout: 3000 }).catch(() => undefined);
            const typed = { ...(await readback(page, requests)), value: await input.inputValue() };
            // Why Enter does or doesn't submit: HTML needs a submit button once a form has more than one text field.
            const owningForm = await input.evaluate((element) => ({
              submitButtons: element.form.querySelectorAll('button[type="submit"], input[type="submit"]').length,
              singleLineFields: [...element.form.elements].filter(
                (control) => control instanceof HTMLInputElement && /^(text|search|url|tel|email|password|number|date|time)$/.test(control.type),
              ).length,
            }));
            await page.keyboard.press('Enter');
            await settle(page);
            const afterEnter = await readback(page, requests);
            await page.mouse.move(0, 0);
            const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
            const dir = await page.evaluate(() => document.documentElement.dir);
            const file = `enter-${screen}-${phase}-${locale}-${width}.png`;
            await page.screenshot({ path: resolve(out, file), fullPage: true, animations: 'disabled' });
            await context.close();
            assert.deepEqual(errors, []);
            assert.deepEqual(unanswered, []);
            assert.equal(overflow, false);
            assert.equal(dir, locale === 'ar' ? 'rtl' : 'ltr');
            assert.equal(typed.dirtySources.length, 1, `${file}: typing makes the form dirty ${JSON.stringify(typed)}`);
            if (phase === 'before') {
              assert.equal(afterEnter.mutations.length, 0, `${file}: main sends nothing on Enter`);
              assert.equal(afterEnter.dirtySources.length, 1);
            } else {
              assert.equal(afterEnter.mutations.length, 1, `${file}: Enter sends one write`);
              assert.deepEqual(afterEnter.dirtySources, []);
            }
            captures.push({
              file,
              screen,
              phase,
              locale,
              width,
              dir,
              overflow,
              field: msg(locale, scene.key),
              owningForm,
              typed,
              afterEnter,
              pageErrors: errors,
            });
          }
    if (beforeOnly) {
      for (const capture of captures)
        console.log(
          `${capture.file}: ${JSON.stringify(capture.owningForm)}, writes after Enter ${capture.afterEnter.mutations.length}, dirty ${JSON.stringify(capture.afterEnter.dirtySources)}`,
        );
      return;
    }

    const en = 'en';
    const general = { screen: 'general', phase: 'after', locale: en };
    const search = { screen: 'search', phase: 'after', locale: en };
    const name = (page) => field(page, en, 'settings.general.name.label');
    const description = (page) => field(page, en, 'settings.general.description.label');

    // No phantom controls: the same Tab stops before and after, and no visible extra submit button.
    for (const screen of ['general', 'search']) {
      const stops = {};
      for (const phase of ['before', 'after'])
        await check(browser, `tab stops (${screen}, ${phase})`, { screen, phase, locale: en }, async (page) => {
          stops[phase] = await tabStops(page);
          return { tabStops: stops[phase], exposedSubmitButtons: await exposedSubmits(page) };
        });
      assert.deepEqual(stops.after, stops.before, `${screen}: Tab order unchanged`);
    }

    await check(
      browser,
      'Enter in a clean form sends nothing',
      general,
      async (page, requests) => {
        await name(page).click();
        await page.keyboard.press('Enter');
        await settle(page);
        return readback(page, requests);
      },
      (r) => assert.equal(r.mutations.length, 0),
    );

    await check(
      browser,
      'Enter in a translation field saves only that language',
      { ...general },
      async (page, requests) => {
        const arabic = page.locator('input[lang="ar"]');
        await arabic.click();
        await page.keyboard.press('End');
        await page.keyboard.type(' ٢');
        await page.keyboard.press('Enter');
        await settle(page);
        return readback(page, requests);
      },
      (r) => {
        assert.equal(r.mutations.length, 1);
        assert.match(r.mutations[0].path, /\/languages\/lang-ar$/);
        assert.deepEqual(r.dirtySources, []);
      },
    );

    await check(
      browser,
      'Enter with an invalid field sends nothing and focuses it',
      general,
      async (page, requests) => {
        await field(page, en, 'settings.general.url.label').fill('');
        await name(page).click();
        await page.keyboard.press('Enter');
        await settle(page);
        return readback(page, requests);
      },
      (r) => {
        assert.equal(r.mutations.length, 0);
        assert.equal(r.focused, 'input[aria-invalid]');
        assert.equal(r.status, msg(en, 'forms.fixHighlighted'));
      },
    );

    await check(
      browser,
      'A failed save keeps the edits',
      { ...general, server: { fail: true } },
      async (page, requests) => {
        await name(page).fill('Fieldnotes Field Guide');
        await page.keyboard.press('Enter');
        await settle(page);
        return { ...(await readback(page, requests)), nameValue: await name(page).inputValue() };
      },
      (r) => {
        assert.equal(r.mutations.length, 1);
        assert.equal(r.nameValue, 'Fieldnotes Field Guide');
        assert.equal(r.dirtySources.length, 1);
      },
    );

    await check(
      browser,
      'Enter, Enter, Ctrl+S and Save during one slow save send one write',
      { ...general, server: { delay: 900 } },
      async (page, requests) => {
        await name(page).fill('Fieldnotes Field Guide');
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        await page.keyboard.press('Control+s');
        await saveBar(page).getByRole('button').last().click({ force: true });
        await page.keyboard.press('Enter');
        await settle(page, 1300);
        return readback(page, requests);
      },
      (r) => {
        assert.equal(r.mutations.length, 1);
        assert.deepEqual(r.dirtySources, []);
      },
    );

    await check(
      browser,
      'Enter in the description textarea adds a line and sends nothing',
      general,
      async (page, requests) => {
        await description(page).click();
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        await page.keyboard.type('Second line');
        await settle(page);
        return { ...(await readback(page, requests)), description: await description(page).inputValue() };
      },
      (r) => {
        assert.equal(r.mutations.length, 0);
        assert.equal(r.description, 'How the Fieldnotes crew works.\nSecond line');
      },
    );

    await check(
      browser,
      'Enter on "Change icon" opens the choices; Enter on an icon choice picks it and sends nothing',
      general,
      async (page, requests) => {
        await page.locator('button[aria-controls][aria-expanded]').focus();
        await page.keyboard.press('Enter');
        await page.locator('fieldset input[type="radio"]').first().focus();
        await page.keyboard.press('ArrowRight');
        const radioFocused = await readback(page, requests);
        await page.keyboard.press('Enter');
        await settle(page);
        return { radioFocused, afterEnterOnRadio: await readback(page, requests) };
      },
      (r) => {
        assert.equal(r.afterEnterOnRadio.mutations.length, 0);
        assert.equal(r.afterEnterOnRadio.dirtySources.length, 1);
      },
    );

    for (const combo of ['Shift+Enter', 'Control+Enter', 'Alt+Enter', 'Meta+Enter'])
      await check(
        browser,
        `${combo} in a single-line field`,
        general,
        async (page, requests) => {
          await name(page).fill('Fieldnotes Field Guide');
          await page.keyboard.press(combo);
          await settle(page);
          return readback(page, requests);
        },
        (r) => {
          assert.equal(r.mutations.length, 0);
          assert.equal(r.dirtySources.length, 1);
        },
      );

    await check(
      browser,
      'Enter while an IME composition is open does not save; Enter after the text is committed does',
      general,
      async (page, requests) => {
        const cdp = await page.context().newCDPSession(page);
        await name(page).click();
        await page.keyboard.press('End');
        await page.evaluate(() => {
          window.__keys = [];
          document.addEventListener('keydown', (event) => window.__keys.push({ key: event.key, isComposing: event.isComposing }), true);
        });
        await cdp.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 });
        await page.keyboard.press('Enter');
        await settle(page);
        const composing = {
          ...(await readback(page, requests)),
          keydowns: await page.evaluate(() => window.__keys),
          nameValue: await name(page).inputValue(),
        };
        // The IME commits the text, ending the composition; only then is Enter the person's.
        await cdp.send('Input.insertText', { text: 'か' });
        await settle(page, 100);
        await page.keyboard.press('Enter');
        await settle(page);
        return {
          composing,
          afterNextEnter: {
            ...(await readback(page, requests)),
            keydowns: await page.evaluate(() => window.__keys),
            nameValue: await name(page).inputValue(),
          },
        };
      },
      (r) => {
        assert.deepEqual(r.composing.keydowns, [{ key: 'Enter', isComposing: true }]);
        assert.equal(r.composing.mutations.length, 0);
        assert.deepEqual(r.afterNextEnter.keydowns.at(-1), { key: 'Enter', isComposing: false });
        assert.equal(r.afterNextEnter.mutations.length, 1, JSON.stringify(r));
        assert.equal(r.afterNextEnter.mutations[0].body.name, r.afterNextEnter.nameValue);
        assert.deepEqual(r.afterNextEnter.dirtySources, []);
      },
    );

    await check(
      browser,
      'Enter opens and picks a hotkey in the Select and toggles a switch; nothing is sent until Enter in a field, which saves both',
      search,
      async (page, requests) => {
        await page.getByLabel(msg(en, 'settings.search.hotkey.label')).focus();
        await page.keyboard.press('Enter');
        await page.getByRole('listbox').waitFor();
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await settle(page);
        const afterSelect = await readback(page, requests);
        await page.getByRole('switch').first().focus();
        await page.keyboard.press('Enter');
        await settle(page);
        const afterSwitchEnter = await readback(page, requests);
        await field(page, en, 'settings.search.placeholder.label').click();
        await page.keyboard.press('Enter');
        await settle(page);
        return { afterSelect, afterSwitchEnter, afterFieldEnter: await readback(page, requests) };
      },
      (r) => {
        assert.equal(r.afterSelect.mutations.length, 0);
        assert.equal(r.afterSelect.dirtySources.length, 1);
        assert.equal(r.afterSwitchEnter.mutations.length, 0);
        assert.equal(r.afterFieldEnter.mutations.length, 1);
        assert.deepEqual(Object.keys(r.afterFieldEnter.mutations[0].body).sort(), ['hotkey', 'versionFilterEnabled']);
      },
    );

    await check(
      browser,
      'Two forms under one save bar: Enter saves its own form only; Ctrl+S then saves the other',
      { screen: 'pair', phase: 'after', locale: en },
      async (page, requests) => {
        await page.getByLabel('Form A · first').fill('Edited A');
        await page.getByLabel('Form B · first').fill('Edited B');
        await page.getByLabel('Form A · second').click();
        await page.keyboard.press('Enter');
        await settle(page);
        const afterEnterInA = await readback(page, requests);
        await page.keyboard.press('Control+s');
        await settle(page);
        return { afterEnterInA, afterCtrlS: await readback(page, requests) };
      },
      (r) => {
        assert.deepEqual(
          r.afterEnterInA.mutations.map((m) => m.path),
          ['/api/fixture/form-a'],
        );
        assert.equal(r.afterEnterInA.saveBarShown, true);
        assert.deepEqual(
          r.afterCtrlS.mutations.map((m) => m.path),
          ['/api/fixture/form-a', '/api/fixture/form-b'],
        );
        assert.equal(r.afterCtrlS.saveBarShown, false);
      },
    );

    await check(
      browser,
      'Two dirty forms: Save in the bar saves both, in order',
      { screen: 'pair', phase: 'after', locale: en },
      async (page, requests) => {
        await page.getByLabel('Form A · first').fill('Edited A');
        await page.getByLabel('Form B · second').fill('Edited B');
        await saveBar(page).getByRole('button').last().click();
        await settle(page);
        return readback(page, requests);
      },
      (r) =>
        assert.deepEqual(
          r.mutations.map((m) => m.path),
          ['/api/fixture/form-a', '/api/fixture/form-b'],
        ),
    );

    // Short recordings with the keyboard: edit, Enter saves; a textarea keeps its newline; Enter twice during a slow save sends one write.
    for (const [locale, width] of [
      ['en', 1440],
      ['ar', 390],
    ]) {
      const file = `flow-general-after-${locale}-${width}.webm`;
      const context = await browser.newContext({
        viewport: { width, height: 800 },
        reducedMotion: 'reduce',
        recordVideo: { dir: harness, size: { width, height: 800 } },
      });
      const { page, errors, requests, unanswered } = await open(context, { screen: 'general', phase: 'after', locale }, { delay: 900 });
      const steps = [];
      const note = async (step) => steps.push({ step, ...(await readback(page, requests)) });
      const nameField = field(page, locale, 'settings.general.name.label');
      await page.waitForTimeout(600);
      await nameField.click();
      await page.keyboard.press('End');
      await page.keyboard.type(' Guide', { delay: 70 });
      await note('typed in the name: dirty, save bar shown');
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
      await note('Enter twice: one write in flight');
      await page.waitForTimeout(1300);
      await note('saved: clean, bar gone, "Saved" announced');
      const textarea = field(page, locale, 'settings.general.description.label');
      await textarea.click();
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('Second line', { delay: 70 });
      await note('Enter in the description: a new line, nothing sent');
      await page.keyboard.press('Control+s');
      await page.waitForTimeout(1300);
      await note('Ctrl+S: the description saved');
      assert.deepEqual(errors, []);
      assert.deepEqual(unanswered, []);
      assert.equal(mutations(requests).length, 2);
      const video = page.video();
      await context.close();
      await video.saveAs(resolve(out, file));
      recordings.push({ file, locale, width, steps, pageErrors: errors });
    }

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(out, 'evidence.json'), {
      environment:
        'Component fixture: the real General and Search settings screens (before: main; after: this branch) with the real design system and EN/AR catalogs; fictional site; API answered by interception, every request recorded; site access fixed to Admin; trusted CDP key events in headless Chromium; not the signed-in dashboard or production',
      baseline,
      head: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain', '--', 'apps/app/src').split('\n').filter(Boolean),
      swappedForBefore: Object.values(beforeFiles),
      attempted: attempted.length,
      captures,
      behaviours,
      recordings,
    });
  });
  console.log(`${captures.length} captures, ${behaviours.length} behaviour checks, ${recordings.length} recordings`);
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    await rm(harness, { recursive: true, force: true });
  }
  await lock.release();
}
