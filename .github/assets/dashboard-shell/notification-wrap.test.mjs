import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { launchLocalOnlyBrowser } from '../../../tests/integration/lib/capture-env.mjs';

// Isolated layout regression, using the real Button, component classes and built CSS.
// Run after the app build: node .github/assets/dashboard-shell/notification-wrap.test.mjs [before-ref]
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const options = { parentURL: import.meta.url, tsconfig: `${repo}/packages/tsconfig/react.json` };
const { Button } = await tsImport('../../../packages/design-system/src/components/ui/button.tsx', options);
const { cn } = await tsImport('../../../packages/design-system/src/lib/utils.ts', options);
const requireApp = createRequire(`${repo}/apps/app/package.json`);
// The Node TSX loader emits classic JSX for this package; use the same React instance as the renderer.
globalThis.React = requireApp('react');
const { createElement: h } = globalThis.React;
const { renderToStaticMarkup } = requireApp('react-dom/server');
const ref = process.argv[2];
const source = (path) =>
  ref ? execFileSync('git', ['show', `${ref}:${path}`], { cwd: repo, encoding: 'utf8' }) : readFileSync(`${repo}/${path}`, 'utf8');
const notifications = source('apps/app/src/components/app/notifications-popover.tsx');
const popover = source('packages/design-system/src/components/ui/popover.tsx');
const popupClass = popover.match(/className=\{cn\(\s*"([^"]+)"/)[1];
const headerClass = notifications.match(/<PopoverContent[^>]*>\s*<div className="([^"]+)"/)[1];
const titleClass = notifications.match(/<span className="([^"]+)">\{t\('notifications.title'\)/)[1];
const actionClass = notifications.match(/className="([^"]+)"\s+disabled=\{!hasUnread\}/)[1];
const listClass = notifications.match(/className="([^"]+)">\s*\{isError && !inbox/)[1];
const de = JSON.parse(readFileSync(`${repo}/packages/i18n/messages/de.json`, 'utf8'));
const assets = `${repo}/apps/app/.output/public/assets`;
const css = readdirSync(assets)
  .filter((name) => name.endsWith('.css'))
  .map((name) => readFileSync(`${assets}/${name}`, 'utf8'))
  .join('\n');
// Nothing outside is reachable (capture-env.mjs); every request is aborted below anyway.
const local = await launchLocalOnlyBrowser();
const { browser } = local;
const results = [];
try {
  for (const [width, height, textScale] of [
    [320, 300, 2],
    [240, 300, 2],
    [720, 450, 1],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.route('**/*', (route) => route.abort());
    const markup = renderToStaticMarkup(
      h(
        'div',
        { 'data-slot': 'popover-content', className: cn(popupClass, 'w-90 gap-0 p-0') },
        h(
          'div',
          { className: headerClass },
          h('span', { className: titleClass }, de.notifications_title),
          h(Button, { className: actionClass, size: 'sm', variant: 'ghost', loading: false }, de.notifications_markallread),
        ),
        h('div', { 'data-list': '', className: listClass }, ...Array.from({ length: 20 }, (_, i) => h('p', { key: i }, `Hinweis ${i + 1}`))),
      ),
    );
    await page.setContent(
      `<html lang="de" style="font-size:${16 * textScale}px;--available-width:${width - 32}px;--available-height:${height - 32}px"><style>${css}</style><style>body{margin:16px;font-family:Arial,sans-serif;background:#fafafa}[data-slot=popover-content]{background:white}</style>${markup}</html>`,
    );
    const result = await page.evaluate(() => {
      const popup = document.querySelector('[data-slot=popover-content]');
      const action = popup.querySelector('button');
      const list = popup.querySelector('[data-list]');
      const p = popup.getBoundingClientRect();
      const a = action.getBoundingClientRect();
      list.scrollTop = list.scrollHeight;
      popup.scrollTop = popup.scrollHeight;
      const last = list.lastElementChild.getBoundingClientRect();
      const result = {
        fits: a.left >= p.left && a.right <= p.right && popup.scrollWidth <= popup.clientWidth,
        verticalScroll: list.scrollTop > 0,
        lastReachable: list.clientHeight > 0 && last.top >= p.top && last.bottom <= p.bottom,
        overflowY: getComputedStyle(popup).overflowY,
        actionHeight: a.height,
        popupWidth: p.width,
      };
      list.scrollTop = 0;
      popup.scrollTop = 0;
      return result;
    });
    results.push({ width, height, textScale, ...result });
    if (!ref) {
      assert(result.fits, JSON.stringify(results.at(-1)));
      assert(result.verticalScroll);
      assert(result.lastReachable);
      assert.equal(result.overflowY, 'auto');
    }
    if (width === 320)
      await page.screenshot({ path: `${repo}/.github/assets/dashboard-shell/${ref ? 'before' : 'after'}-review-notifications-de-320-text-zoom.png` });
    await page.close();
  }
  if (ref)
    assert(
      results.some((result) => !result.fits),
      'Before fixture must reproduce the overflow',
    );
  appendFileSync(
    `${repo}/.github/assets/dashboard-shell/verification.jsonl`,
    `${JSON.stringify({ type: 'notificationWrapFixture', scope: 'isolated header, actual Button and built CSS; CSS viewport and text-size emulation, not native zoom controls', ref: ref ?? 'worktree', results })}\n`,
  );
  console.log(JSON.stringify(results));
} finally {
  await local.close();
}
