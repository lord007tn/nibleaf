// Isolated component fixture of Settings → Git → two-way sync → Reconcile conflicts: main's GitWorkflow and inline
// ConflictCard (before) and this branch's (after), with the real design system, EN/AR catalogs, the app's own
// QueryClient (wrapped to record which keys are invalidated) and the Git workflow status query, for two fictional
// sites. Every API request is answered by interception on the fixture origin; a resolution POST, and the status
// read after it, can be held until the script answers. Not the signed-in dashboard and not production. No server
// starts, and no repository, conflict or provider is touched anywhere.
//
// Run it while holding the repository's heavy-step lock; it takes no lock itself.
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
const require = createRequire(resolve(app, 'package.json'));
const fromApp = async (name) => import(pathToFileURL(require.resolve(name)).href);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const catalogs = {
  en: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/en.json'), 'utf8')),
  ar: JSON.parse(await readFile(resolve(root, 'packages/i18n/messages/ar.json'), 'utf8')),
};
/** A message by its id as the code names it (`settings.git.workflow.conflict.useGit`). */
const msg = (locale, id) => catalogs[locale][id.replaceAll('.', '_').toLowerCase()];
const origin = 'http://git-conflict-resolution.fixture.test';
/** The main commit this branch starts from (#786); evidence.json records it as `base`. */
const BASE = '9f4e4178c438bd13438056f65cf8506381edb865';
/** Synthetic conflict ids; evidence names them `<id#n>`. */
const ID = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const label = (text) => text.replace(/00000000-0000-4000-8000-00000000000(\d)/g, '<id#$1>');
const conflict = (n, path) => ({
  id: ID(n),
  path,
  status: 'OPEN',
  baseContent: `# ${path}\n\nThe shared baseline.\n`,
  oursContent: `# ${path}\n\nEdited in Nibleaf.\n`,
  theirsContent: `# ${path}\n\nEdited in Git.\n`,
});
const conflictsFor = () => ({ 'site-a': [conflict(1, 'docs/intro.md'), conflict(2, 'docs/setup.md')], 'site-b': [conflict(3, 'docs/guide.md')] });
const status = (site, open) => ({
  id: `connection-${site}`,
  repository: `acme-fixture/${site === 'site-a' ? 'handbook' : 'guides'}`,
  baseBranch: 'main',
  headBranch: 'nibleaf/docs',
  contentPath: 'docs',
  credentialConfigured: true,
  webhookConfigured: true,
  lastSyncStatus: 'CONFLICT',
  lastSyncError: null,
  lastSyncedAt: '2026-11-15T09:00:00.000Z',
  operations: [
    {
      id: `operation-${site}`,
      kind: 'PULL',
      status: 'CONFLICT',
      commitMessage: null,
      changedFiles: null,
      pullRequestNo: null,
      pullRequestUrl: null,
      error: null,
      createdAt: '2026-11-15T09:00:00.000Z',
      conflicts: open[site],
    },
  ],
  pullRequests: [],
  files: [],
});

let harness;
try {
  harness = await mkdtemp(resolve(app, '.git-conflict-capture-'));
  await mkdir(resolve(harness, 'before'), { recursive: true });
  // Main's resolution and operation hooks as they are on the base (both are gone from the app); every other hook is today's.
  await writeFile(
    resolve(harness, 'before/git-workflow-hooks.ts'),
    git('show', `${BASE}:apps/app/src/hooks/api/git-workflow.ts`).replace(/from '\.\/([\w-]+)'/g, "from '@/hooks/api/$1'"),
  );
  await writeFile(
    resolve(harness, 'before/hooks.ts'),
    "export * from '@/hooks/api';\nexport { useQueueGitOperation, useResolveGitConflict } from './git-workflow-hooks';\n",
  );
  await writeFile(
    resolve(harness, 'before/git-workflow.tsx'),
    git('show', `${BASE}:apps/app/src/components/settings/git-workflow.tsx`).replace("from '@/hooks/api'", "from './hooks'"),
  );
  await writeFile(
    resolve(harness, 'index.html'),
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="bg-background"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>',
  );
  await writeFile(
    resolve(harness, 'styles.css'),
    '@import "@nibleaf/design-system/globals.css";\n@source "./";\n@source "../src/features/site-git";\n@source "../src/components";\n@source "../../../packages/design-system/src";\n',
  );
  // The settings page keys the Git tab by site (`git-${projectId}`): `setSite` is leaving for another site.
  // `?copies=2` mounts the same site's panel twice (programmatic: the settings page never does).
  await writeFile(
    resolve(harness, 'main.tsx'),
    `
import './styles.css';
import { ConfirmProvider } from '@nibleaf/design-system/components/ui/confirm';
import { DirectionProvider } from '@nibleaf/design-system/components/ui/direction';
import { Toaster } from '@nibleaf/design-system/components/ui/sonner';
import { setLanguage } from '@nibleaf/i18n/locale-state';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GitWorkflow as After } from '@/components/settings/git-workflow';
import { createQueryClient } from '@/integrations/tanstack-query/query-client';
import { GitWorkflow as Before } from './before/git-workflow';

const params = new URLSearchParams(location.search);
const locale = params.get('locale') === 'ar' ? 'ar' : 'en';
await setLanguage(locale);
document.documentElement.classList.add('light');
const client = createQueryClient();
const fixture = window as unknown as { invalidated: unknown[]; setSite?: (site: string) => void };
fixture.invalidated = [];
const invalidate = client.invalidateQueries.bind(client);
client.invalidateQueries = ((filters, options) => {
  fixture.invalidated.push(filters?.queryKey ?? null);
  return invalidate(filters, options);
}) as typeof client.invalidateQueries;
const Workflow = params.get('version') === 'before' ? Before : After;
const copies = Number(params.get('copies') ?? '1');
function Page() {
  const [site, setSite] = useState('site-a');
  fixture.setSite = setSite;
  return (
    <>
      {Array.from({ length: copies }, (_, copy) => (
        <div data-copy={copy} key={\`git-\${site}-\${copy}\`}>
          <Workflow projectId={site} />
        </div>
      ))}
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}>
    <ConfirmProvider>
      <DirectionProvider direction={locale === 'ar' ? 'rtl' : 'ltr'}>
        <main className="mx-auto w-full max-w-5xl px-4 pt-6 pb-24 text-foreground sm:px-8"><Page /></main>
      </DirectionProvider>
      <Toaster theme="light" />
    </ConfirmProvider>
  </QueryClientProvider>,
);
`,
  );
  const { build } = await fromApp('vite');
  await build({
    configFile: false,
    root: harness,
    logLevel: 'error',
    define: { 'import.meta.env.VITE_APP_URL': JSON.stringify(origin) },
    resolve: { alias: [{ find: /^@\//, replacement: `${resolve(app, 'src')}/` }] },
    plugins: [
      // Without TanStack Start's plugin, the isomorphic API origin keeps its
      // server branch (and the server env); the browser only ever takes the client one.
      {
        name: 'client-api-origin',
        enforce: 'pre',
        resolveId: (source, importer) =>
          source === './api-origin' && importer?.replaceAll('\\', '/').endsWith('/src/services/api.ts') ? '\0client-api-origin' : undefined,
        load: (id) => (id === '\0client-api-origin' ? 'export const apiOrigin = () => window.location.origin;' : undefined),
      },
      (await fromApp('@vitejs/plugin-react')).default(),
      (await fromApp('@tailwindcss/vite')).default(),
    ],
    build: { outDir: resolve(harness, 'dist'), target: 'esnext' },
  });
  const dist = resolve(harness, 'dist');
  const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2' };

  /**
   * Opens the fixture on site A. The status GET returns the site's open
   * conflicts. A resolution POST is held while `server.hold` (until
   * `server.release()`), refused with 409 if `server.refuse` (once), else
   * answered as the server does: the first resolution of an open conflict
   * resolves it (the next status read no longer lists it), a later one returns
   * the resolved conflict unchanged. While `server.holdRead`, the next status
   * GET is held too. Any other API call fails the run.
   */
  async function open(context, { locale, version, copies = 1 }) {
    const page = await context.newPage();
    const errors = [];
    const requests = [];
    const held = [];
    const open = conflictsFor();
    const resolved = new Map();
    const server = {
      hold: false,
      holdRead: false,
      refuse: false,
      release: () => held.shift()?.(),
      held: () => held.length,
      open,
    };
    const json = (route, body, statusCode = 200) =>
      route.fulfill({ status: statusCode, contentType: 'application/json', body: JSON.stringify(body) });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const call = `${request.method()} ${url.pathname}`;
      const read = /^GET \/api\/app\/projects\/(site-[ab])\/git$/.exec(call);
      if (read) {
        requests.push({ call });
        if (server.holdRead) {
          server.holdRead = false;
          await new Promise((done) => held.push(done));
        }
        return json(route, { data: status(read[1], open) });
      }
      const resolution = /^POST \/api\/app\/projects\/(site-[ab])\/git\/conflicts\/([^/]+)\/resolve$/.exec(call);
      if (resolution) {
        const [, site, conflictId] = resolution;
        const body = JSON.parse(request.postData() ?? 'null');
        requests.push({ call: label(call), body });
        if (server.hold) await new Promise((done) => held.push(done));
        if (server.refuse) {
          server.refuse = false;
          return json(route, { error: { code: 'database:conflict', message: 'The conflict changed.' } }, 409);
        }
        const item = open[site].find((candidate) => candidate.id === conflictId);
        if (item) {
          open[site] = open[site].filter((candidate) => candidate !== item);
          resolved.set(conflictId, { ...item, status: 'RESOLVED', resolution: body.resolution });
        }
        return json(route, { data: resolved.get(conflictId) });
      }
      assert.ok(!url.pathname.startsWith('/api/'), `unexpected API call ${call}`);
      const file = resolve(dist, url.pathname.startsWith('/assets/') ? `.${url.pathname}` : 'index.html');
      assert.ok(file.startsWith(`${dist}${sep}`));
      await route.fulfill({ body: await readFile(file), contentType: mime[extname(file)] ?? 'application/octet-stream' });
    });
    await page.goto(`${origin}/?locale=${locale}&version=${version}&copies=${copies}`);
    await card(page, 'docs/intro.md').first().waitFor({ timeout: 15_000 });
    await page.waitForTimeout(200);
    await page.evaluate(() => document.fonts.ready);
    return { page, errors, requests, server };
  }

  /** A conflict card by its path (the card's header holds the path). */
  const card = (page, path, copy = 0) => page.locator(`[data-copy="${copy}"]`).locator(`xpath=.//section[div/code[text()="${path}"]]`);
  const LABELS = { OURS: 'useNibleaf', THEIRS: 'useGit', CUSTOM: 'useCustom', DELETE: 'delete' };
  const button = (page, locale, path, choice, copy = 0) =>
    card(page, path, copy).locator('button', { hasText: msg(locale, `settings.git.workflow.conflict.${LABELS[choice]}`) });
  const conflicts = (page, locale) =>
    page.locator('[data-copy="0"] section', { has: page.getByRole('heading', { name: msg(locale, 'settings.git.workflow.conflict.title') }) });
  const settle = (page, ms = 300) => page.waitForTimeout(ms);
  /** Waits for at least `count` held answers (main may send more: the counts are asserted per state). */
  const arrived = async (page, server, count = 1) => {
    for (let tries = 0; server.held() < count && tries < 100; tries += 1) await page.waitForTimeout(50);
    assert.ok(server.held() >= count);
  };
  const setSite = async (page, site) => {
    await page.evaluate((next) => window.setSite(next), site);
    await settle(page, 500);
  };
  const posts = (requests) => requests.filter(({ call }) => call.startsWith('POST'));
  /** What a reviewer should see: each card's custom text and buttons (busy, disabled), toasts, refreshed keys. */
  const readback = (page) =>
    page.evaluate(async () => {
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      const cards = [...document.querySelectorAll('[data-copy] section')].filter((node) => node.querySelector(':scope > div > code'));
      return {
        dir: document.documentElement.dir,
        cards: cards.map((node) => ({
          copy: Number(node.closest('[data-copy]')?.getAttribute('data-copy')),
          path: node.querySelector(':scope > div > code')?.textContent,
          sides: [...node.querySelectorAll('pre')].map((pre) => pre.textContent),
          custom: node.querySelector('textarea')?.value ?? null,
          busy: [...node.querySelectorAll('button')].map((button) => button.getAttribute('aria-busy') === 'true'),
          disabled: [...node.querySelectorAll('button')].map((button) => button.disabled),
        })),
        toasts: [...document.querySelectorAll('[data-sonner-toast]')].map((node) => node.textContent?.trim()),
        invalidated: window.invalidated,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
  const cardOf = (read, path, copy = 0) => read.cards.find((item) => item.path === path && item.copy === copy);
  const busy = (read, path, copy = 0) => {
    const states = cardOf(read, path, copy)?.busy ?? [];
    assert.equal(new Set(states).size, 1, `the four buttons of ${path} disagree on busy`);
    return states[0];
  };
  const CUSTOM_TEXT = '# المقدمة\n\nMerged by hand: both edits kept.\n';

  /** Each state, run on both versions: what the person did before the screenshot. */
  const STATES = {
    ready: { label: 'Two open conflicts on site A, nothing pressed', run: async () => undefined },
    sameTick: {
      label: 'Use Nibleaf, Use Git, Use custom and Delete file pressed in one task, request held',
      run: async ({ page, server, locale }) => {
        server.hold = true;
        await card(page, 'docs/intro.md').evaluate(
          (section, labels) => {
            for (const text of labels) [...section.querySelectorAll('button')].find((item) => item.textContent?.includes(text))?.click();
          },
          Object.values(LABELS).map((key) => msg(locale, `settings.git.workflow.conflict.${key}`)),
        );
        await arrived(page, server);
        await settle(page);
      },
    },
    remount: {
      label: 'Use Nibleaf on site A (held), leave for site B and back to A, press Use Git',
      run: async ({ page, server, locale }) => {
        server.hold = true;
        await button(page, locale, 'docs/intro.md', 'OURS').click();
        await arrived(page, server);
        await setSite(page, 'site-b');
        await setSite(page, 'site-a');
        server.reopened = busy(await readback(page), 'docs/intro.md');
        await button(page, locale, 'docs/intro.md', 'THEIRS')
          .click({ timeout: 2000 })
          .catch(() => undefined);
        await settle(page);
      },
    },
    leaveSuccess: {
      label: 'Use Nibleaf on site A (held), leave for site B, then A succeeds',
      run: async ({ page, server, locale }) => {
        server.hold = true;
        await button(page, locale, 'docs/intro.md', 'OURS').click();
        await arrived(page, server);
        await setSite(page, 'site-b');
        server.hold = false;
        server.release();
        await settle(page, 600);
      },
    },
    leaveRefusal: {
      label: 'Use Nibleaf on site A (held), leave for site B, then A is refused (409)',
      run: async ({ page, server, locale }) => {
        server.hold = true;
        server.refuse = true;
        await button(page, locale, 'docs/intro.md', 'OURS').click();
        await arrived(page, server);
        await setSite(page, 'site-b');
        server.hold = false;
        server.release();
        await settle(page, 600);
      },
    },
    refusal: {
      label: 'Custom text typed (Arabic, newlines), Use custom refused (409)',
      run: async ({ page, server, locale }) => {
        await card(page, 'docs/intro.md').locator('textarea').fill(CUSTOM_TEXT);
        server.refuse = true;
        await button(page, locale, 'docs/intro.md', 'CUSTOM').click();
        await settle(page, 600);
      },
    },
    independent: {
      label: 'Use Nibleaf on intro.md (held), then Use Git on setup.md',
      run: async ({ page, server, locale }) => {
        server.hold = true;
        await button(page, locale, 'docs/intro.md', 'OURS').click();
        await arrived(page, server);
        server.hold = false;
        await button(page, locale, 'docs/setup.md', 'THEIRS').click();
        await settle(page, 600);
      },
    },
    twoCopies: {
      copies: 2,
      label: 'Programmatic: the same panel mounted twice, Use Nibleaf in one and Use Git in the other in one task (held)',
      run: async ({ page, server, locale }) => {
        server.hold = true;
        const labels = [msg(locale, 'settings.git.workflow.conflict.useNibleaf'), msg(locale, 'settings.git.workflow.conflict.useGit')];
        await page.evaluate((texts) => {
          texts.forEach((text, copy) => {
            const section = [...document.querySelectorAll(`[data-copy="${copy}"] section`)].find(
              (node) => node.querySelector(':scope > div > code')?.textContent === 'docs/intro.md',
            );
            [...(section?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.includes(text))?.click();
          });
        }, labels);
        await arrived(page, server);
        await settle(page);
      },
    },
  };

  const captures = [];
  const recordings = [];
  await withLocalOnlyBrowser({ allowedHosts: [hostKey(origin)] }, async ({ browser, attempted }) => {
    for (const width of [390, 1440]) {
      const shots = {};
      const seen = {};
      for (const locale of ['en', 'ar']) {
        for (const [state, { run, copies }] of Object.entries(STATES)) {
          for (const version of ['before', 'after']) {
            const context = await browser.newContext({ viewport: { width, height: 1100 }, reducedMotion: 'reduce', colorScheme: 'light' });
            const { page, errors, requests, server } = await open(context, { locale, version, copies });
            await run({ page, server, locale });
            const read = await readback(page);
            assert.equal(read.dir, locale === 'ar' ? 'rtl' : 'ltr');
            assert.equal(read.overflow, false, `${locale}/${state}/${version} overflows at ${width}px`);
            assert.deepEqual(errors, []);
            await page.mouse.move(0, 0);
            await conflicts(page, locale).scrollIntoViewIfNeeded();
            shots[`${locale}-${state}-${version}`] = await conflicts(page, locale).screenshot({ animations: 'disabled' });
            seen[`${locale}-${state}-${version}`] = {
              ...read,
              ...(server.reopened !== undefined ? { reopenedBusy: server.reopened } : {}),
              requests: requests.map((item) => ({ ...item })),
            };
            // Answer anything still held so the context closes cleanly.
            server.hold = false;
            while (server.held()) server.release();
            await context.close();
          }
        }
        // The behaviour each sheet shows, asserted so a wrong capture fails the run.
        const at = (state, version) => seen[`${locale}-${state}-${version}`];
        const A = ['git-workflow', 'site-a'];
        const intro = 'POST /api/app/projects/site-a/git/conflicts/<id#1>/resolve';
        const oursText = conflict(1, 'docs/intro.md').oursContent;
        for (const version of ['before', 'after']) {
          assert.deepEqual(
            at('ready', version).cards.map(({ path }) => path),
            ['docs/intro.md', 'docs/setup.md'],
          );
          assert.equal(busy(at('sameTick', version), 'docs/intro.md'), true);
          assert.equal(busy(at('sameTick', version), 'docs/setup.md'), false);
          // Leaving: the success refreshes site A only and reports nothing; a refusal refreshes and reports nothing.
          assert.deepEqual(at('leaveSuccess', version).invalidated, [A]);
          assert.deepEqual(at('leaveSuccess', version).toasts, []);
          assert.deepEqual(at('leaveRefusal', version).invalidated, []);
          assert.deepEqual(at('leaveRefusal', version).toasts, []);
          // A refusal: reported once, nothing refreshed, the custom text kept exactly.
          assert.deepEqual(posts(at('refusal', version).requests), [{ call: intro, body: { resolution: 'CUSTOM', content: CUSTOM_TEXT } }]);
          assert.equal(at('refusal', version).toasts.length, 1);
          assert.deepEqual(at('refusal', version).invalidated, []);
          assert.equal(cardOf(at('refusal', version), 'docs/intro.md').custom, CUSTOM_TEXT);
          assert.equal(busy(at('refusal', version), 'docs/intro.md'), false);
          // Another conflict stays usable while one waits.
          assert.equal(busy(at('independent', version), 'docs/intro.md'), true);
          assert.equal(cardOf(at('independent', version), 'docs/setup.md'), undefined);
          assert.deepEqual(at('independent', version).invalidated, [A]);
        }
        // Main: four POSTs for one conflict in one task; here one.
        assert.deepEqual(
          posts(at('sameTick', 'before').requests).map(({ body }) => body),
          [{ resolution: 'OURS' }, { resolution: 'THEIRS' }, { resolution: 'CUSTOM', content: oursText }, { resolution: 'CUSTOM', content: null }],
        );
        assert.deepEqual(posts(at('sameTick', 'after').requests), [{ call: intro, body: { resolution: 'OURS' } }]);
        // Main: A → B → A shows the conflict idle while it resolves, and Use Git sends a second, conflicting POST.
        assert.equal(at('remount', 'before').reopenedBusy, false);
        assert.deepEqual(
          posts(at('remount', 'before').requests).map(({ body }) => body),
          [{ resolution: 'OURS' }, { resolution: 'THEIRS' }],
        );
        assert.equal(at('remount', 'after').reopenedBusy, true);
        assert.deepEqual(posts(at('remount', 'after').requests), [{ call: intro, body: { resolution: 'OURS' } }]);
        // Programmatic: two copies send two conflicting resolutions on main; here one, both copies busy.
        assert.equal(posts(at('twoCopies', 'before').requests).length, 2);
        assert.equal(posts(at('twoCopies', 'after').requests).length, 1);
        assert.equal(busy(at('twoCopies', 'after'), 'docs/intro.md', 1), true);
      }

      const file = `states-${width}.png`;
      const scale = width < 800 ? 1 : 0.5;
      const shown = Math.round(Math.min(width, 1024) * scale);
      const sheet = await browser.newContext({ viewport: { width: shown * 2 + 48, height: 600 }, deviceScaleFactor: 1 });
      const sheetPage = await sheet.newPage();
      const caption = (key) => {
        const { requests, toasts, invalidated, reopenedBusy, cards } = seen[key];
        const keys = invalidated.map((item) => JSON.stringify(item)).join(' ') || 'none';
        const bodies = posts(requests)
          .map(({ body }) => (body.content === undefined ? body.resolution : `${body.resolution}(${body.content === null ? 'null' : 'text'})`))
          .join(', ');
        const busyCards = cards.filter((item) => item.busy[0]).map((item) => `${item.path}${item.copy ? ` (copy ${item.copy + 1})` : ''}`);
        return `${reopenedBusy !== undefined ? `busy on return to A ${reopenedBusy} · ` : ''}POSTs ${posts(requests).length}${bodies ? ` [${bodies}]` : ''} · busy ${busyCards.join(', ') || 'none'} · refreshed ${keys} · toasts ${toasts.length ? toasts.join(' | ') : 'none'}`;
      };
      const panel = (key) =>
        `<img src="data:image/png;base64,${shots[key].toString('base64')}" width="${shown}" style="display:block;border:1px solid #bbb"><div style="font-size:11px;margin-top:2px;max-width:${shown}px">${caption(key)}</div>`;
      const rows = (locale) =>
        Object.entries(STATES)
          .map(
            ([state, { label: text }]) =>
              `<div style="grid-column:1/3;margin-top:10px"><b>${locale.toUpperCase()} · ${text}</b></div><div>${panel(`${locale}-${state}-before`)}</div><div>${panel(`${locale}-${state}-after`)}</div>`,
          )
          .join('');
      await sheetPage.setContent(
        `<body style="margin:0;padding:16px;background:#e5e5e5;font:13px system-ui,sans-serif;color:#111">
<div><b>Component fixture</b> (not the dashboard, not production) · Settings → Git → Reconcile conflicts · ${width}px viewport${scale < 1 ? ' (shown at 50%)' : ''} · fictional sites and conflicts, every request intercepted</div>
<div style="display:grid;grid-template-columns:${shown}px ${shown}px;gap:8px 16px;margin-top:8px"><div><b>Before (main ${BASE.slice(0, 9)})</b></div><div><b>After (this branch)</b></div>${rows('en')}${rows('ar')}</div></body>`,
      );
      await sheetPage.waitForFunction(() => [...document.images].every((image) => image.complete));
      await sheetPage.screenshot({ path: resolve(import.meta.dirname, file), fullPage: true, type: 'png' });
      await sheet.close();
      captures.push({ file, width, theme: 'light', states: seen });
    }

    // Custom text → Use custom held and refused → text kept → retry held → leave and come back → Use Git →
    // success with its readback held → readback, on both versions.
    for (const version of ['before', 'after']) {
      const locale = 'en';
      const width = 1440;
      const file = `flow-${version}-${locale}-${width}.webm`;
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
        recordVideo: { dir: harness, size: { width, height: 900 } },
      });
      const { page, errors, requests, server } = await open(context, { locale, version });
      const pause = (ms = 700) => page.waitForTimeout(ms);
      const steps = [];
      const note = async (step) => {
        const read = await readback(page);
        steps.push({ step, ...read, requests: requests.map((item) => ({ ...item })) });
      };
      await conflicts(page, locale).scrollIntoViewIfNeeded();
      await pause();
      await card(page, 'docs/intro.md').locator('textarea').fill(CUSTOM_TEXT);
      await pause();
      server.hold = true;
      server.refuse = true;
      await button(page, locale, 'docs/intro.md', 'CUSTOM').click();
      await arrived(page, server);
      await pause();
      await note('Use custom held: busy');
      server.release();
      await pause(1200);
      await note('Use custom refused (409)');
      await button(page, locale, 'docs/intro.md', 'CUSTOM').click();
      await arrived(page, server);
      await pause();
      await note('retry held: busy');
      await setSite(page, 'site-b');
      await pause();
      await note('left for site B while A resolves');
      await setSite(page, 'site-a');
      await conflicts(page, locale).scrollIntoViewIfNeeded();
      await pause();
      await note('back on site A while it resolves');
      await button(page, locale, 'docs/intro.md', 'THEIRS')
        .click({ timeout: 2000 })
        .catch(() => undefined);
      await pause();
      await note('Use Git pressed on site A');
      server.hold = false;
      server.holdRead = true;
      while (server.held()) server.release();
      await pause(1200);
      await note('answered: resolved, status read held');
      server.release();
      await pause(1200);
      await note('status read: intro.md resolved');
      await pause(1200);
      assert.deepEqual(errors, []);
      const video = page.video();
      await context.close();
      await video.saveAs(resolve(import.meta.dirname, file));
      recordings.push({ file, version, locale, width, theme: 'light', pageErrors: errors, steps });
    }
    const flow = (version, prefix) => recordings.find((item) => item.version === version).steps.find(({ step }) => step.startsWith(prefix));
    const custom = { resolution: 'CUSTOM', content: CUSTOM_TEXT };
    for (const version of ['before', 'after']) {
      assert.equal(busy(flow(version, 'Use custom held'), 'docs/intro.md'), true);
      assert.equal(flow(version, 'Use custom refused').toasts.length, 1);
      assert.equal(cardOf(flow(version, 'Use custom refused'), 'docs/intro.md').custom, CUSTOM_TEXT);
      assert.deepEqual(flow(version, 'Use custom refused').invalidated, []);
      assert.equal(cardOf(flow(version, 'status read'), 'docs/intro.md'), undefined);
      assert.ok(cardOf(flow(version, 'status read'), 'docs/setup.md'));
    }
    // Main: back on A while it resolves shows it idle, and Use Git sends a third POST; here it stays busy and sends none.
    assert.equal(busy(flow('before', 'back on site A'), 'docs/intro.md'), false);
    assert.deepEqual(
      posts(flow('before', 'status read').requests).map(({ body }) => body),
      [custom, custom, { resolution: 'THEIRS' }],
    );
    assert.equal(busy(flow('after', 'back on site A'), 'docs/intro.md'), true);
    // Leaving and coming back is a new card on both: its custom text starts again from the Nibleaf version.
    for (const version of ['before', 'after']) {
      assert.equal(cardOf(flow(version, 'back on site A'), 'docs/intro.md').custom, conflict(1, 'docs/intro.md').oursContent);
    }
    assert.deepEqual(
      posts(flow('after', 'status read').requests).map(({ body }) => body),
      [custom, custom],
    );
    // Here the success stays busy until its status read answers.
    assert.equal(busy(flow('after', 'answered'), 'docs/intro.md'), true);

    assert.equal(attempted.length, 0);
    await writeEvidenceJson(resolve(import.meta.dirname, 'evidence.json'), {
      environment: `Component fixture: main's GitWorkflow and inline ConflictCard (${BASE}) and this branch's, with the real design system, EN/AR catalogs, the app's QueryClient (invalidations recorded) and the Git workflow status query; each resolution POST answered by interception (resolved, or a 409), optionally held, as is the status read after it; fictional sites, repositories and conflicts (ids shown as <id#n>); not the signed-in dashboard, production, the server, a repository or a Git provider`,
      base: git('rev-parse', BASE),
      head: git('rev-parse', 'HEAD'),
      uncommitted: git('status', '--porcelain', '--', 'apps/app/src').split('\n').filter(Boolean),
      attempted: attempted.length,
      captures,
      recordings,
    });
  });
  console.log(`${captures.length} before/after sheets and ${recordings.length} recordings; no overflow, page errors or outside requests`);
} finally {
  if (harness) {
    assert.ok(harness.startsWith(`${app}${sep}`));
    // Windows may hold the recording open for a moment after the browser closes.
    await rm(harness, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}
