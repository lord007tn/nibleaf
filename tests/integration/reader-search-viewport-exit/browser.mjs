import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { hostKey, withLocalOnlyBrowser } from '../lib/capture-env.mjs';
import { writeEvidenceJson } from '../lib/evidence-json.mjs';

const APP = 'http://localhost:4310';
const output = resolve('.github/assets/reader-search-viewport-exit');
const lock = process.env.NIBLEAF_DEVSTACK_LOCK;
assert.ok(lock, 'NIBLEAF_DEVSTACK_LOCK must name the canonical shared directory');
assert.match(await readFile(resolve(lock, 'owner.txt'), 'utf8'), /^reader\/848 token=\S+\nbranch=test\/reader-search-real-exit\n/);
await mkdir(output, { recursive: true });
const cases = [];
// Hash the exercised entry and production contracts, so the evidence remains
// attributable even when a later commit only adds the generated capture files.
const sourceFiles = [
  new URL('../../../apps/app/tests/reader-search-viewport-exit/harness.tsx', import.meta.url),
  new URL('../../../apps/app/tests/reader-search-viewport-exit/harness.css', import.meta.url),
  new URL('../../../apps/app/src/components/site/site-search.tsx', import.meta.url),
  new URL('../../../apps/app/src/components/site/site-search-dialog.tsx', import.meta.url),
  new URL('../../../apps/app/src/components/site/use-visual-viewport.ts', import.meta.url),
  new URL('../../../packages/design-system/src/components/ui/dialog.tsx', import.meta.url),
  new URL('../../../packages/design-system/src/styles/globals.css', import.meta.url),
];
const sourceHashes = await Promise.all(
  sourceFiles.map(async (url) => ({
    file: url.pathname.split('/').slice(-1)[0],
    sha256: createHash('sha256')
      .update(await readFile(url))
      .digest('hex'),
  })),
);

await withLocalOnlyBrowser({ allowedHosts: [hostKey(APP)] }, async ({ browser, attempted }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'no-preference',
    recordVideo: { dir: resolve('output/reader-search-viewport-exit-video'), size: { width: 390, height: 844 } },
  });
  await context.addInitScript(() => {
    const listeners = { resize: new Set(), scroll: new Set() };
    class SyntheticViewport extends EventTarget {
      height = 844;
      width = 390;
      offsetTop = 0;
      offsetLeft = 0;
      pageTop = 0;
      pageLeft = 0;
      scale = 1;
      addEventListener(type, listener, options) {
        listeners[type]?.add(listener);
        super.addEventListener(type, listener, options);
      }
      removeEventListener(type, listener, options) {
        listeners[type]?.delete(listener);
        super.removeEventListener(type, listener, options);
      }
      change(height, top) {
        this.height = height;
        this.offsetTop = top;
        this.dispatchEvent(new Event('resize'));
        this.dispatchEvent(new Event('scroll'));
      }
    }
    const viewport = new SyntheticViewport();
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    window.viewportFixture = {
      viewport,
      listenerCounts: () => Object.fromEntries(Object.entries(listeners).map(([key, value]) => [key, value.size])),
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const field = page.locator('[data-slot="command-input"]');
  const popup = page.locator('[data-theme-surface="search"]');

  const open = async (height, top) => {
    const before = await page.evaluate(
      ({ height, top }) => {
        window.viewportFixture.viewport.change(height, top);
        const before = window.readerExit.observe.completions.length;
        window.readerExit.open();
        return before;
      },
      { height, top },
    );
    await page.waitForFunction((before) => window.readerExit.observe.completions.slice(before).some((event) => event.open), before);
    await page.waitForFunction(
      ({ height, top }) => {
        const box = window.readerExit.observe.snapshot();
        return box?.heightVar === `${height}px` && box.topVar === `${top}px`;
      },
      { height, top },
    );
  };

  const closeTrace = async ({ interrupted = false, height = 470, top = 96 } = {}) =>
    page.evaluate(
      async ({ interrupted, height, top }) => {
        const { observe, open } = window.readerExit;
        const fixture = window.viewportFixture;
        const completionStart = observe.completions.length;
        const changeStart = observe.changes.length;
        const samples = [];
        let mutationAt = null;
        let closeAt = null;
        let opening = null;
        let tailFrames = 0;
        // Sampling is armed before either close. No sleeps or fabricated completion.
        return await new Promise((resolve, reject) => {
          const deadline = performance.now() + 5000; // Failure watchdog only.
          const frame = () => {
            const box = observe.snapshot();
            samples.push(box);
            const completions = observe.completions.slice(completionStart);
            if (performance.now() > deadline) return reject(new Error('Real animation/completion did not arrive'));
            if (closeAt === null) {
              if (
                !interrupted ||
                (box?.mounted && !box.closed && box.animations.some((animation) => animation.progress > 0 && animation.progress < 1))
              ) {
                opening = interrupted ? box : null;
                closeAt = performance.now();
                document
                  .querySelector('[data-slot="command-input"]')
                  .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
              }
            } else if (
              mutationAt === null &&
              box?.mounted &&
              box.closed &&
              box.animations.some((animation) => animation.progress > 0 && animation.progress < 1)
            ) {
              mutationAt = performance.now();
              fixture.viewport.change(700, 12);
            }
            if (completions.some((event) => !event.open) && ++tailFrames === 3)
              return resolve({
                interrupted,
                height,
                top,
                closeAt,
                mutationAt,
                opening,
                samples,
                completions,
                changes: observe.changes.slice(changeStart),
                listeners: fixture.listenerCounts(),
              });
            requestAnimationFrame(frame);
          };
          requestAnimationFrame(frame);
          if (interrupted) {
            fixture.viewport.change(height, top);
            open();
          }
        });
      },
      { interrupted, height, top },
    );

  const checkTrace = (trace) => {
    const completion = trace.completions.find((event) => !event.open);
    assert.ok(completion, 'Actual false completion must be observed');
    assert.equal(trace.changes.length, 1, 'Escape reaches the real Dialog onOpenChange callback');
    assert.equal(trace.changes[0].open, false);
    assert.ok(trace.mutationAt > trace.closeAt && trace.mutationAt < completion.at, 'Viewport changes during the real exit');
    const exit = trace.samples.filter((sample) => sample?.mounted && sample.closed && sample.at < completion.at);
    assert.ok(
      exit.some((sample) => sample.at > trace.mutationAt && sample.animations.some((animation) => animation.progress > 0 && animation.progress < 1)),
      'Mounted intermediate frame after viewport mutation',
    );
    for (const sample of [...exit, completion.box]) {
      assert.equal(sample.heightVar, `${trace.height}px`);
      assert.equal(sample.topVar, `${trace.top}px`);
      if (sample.mounted) {
        assert.equal(sample.cssHeight, `${trace.height}px`);
        assert.equal(sample.cssTop, `${trace.top}px`);
      }
    }
    const durations = exit.flatMap((sample) => sample.animations.map((animation) => animation.duration));
    assert.ok(durations.includes(100), 'Production 100ms fade/zoom animation is active');
    assert.ok(
      exit.some((sample) => Number(sample.opacity) > 0 && Number(sample.opacity) < 1),
      'Real intermediate opacity',
    );
    assert.ok(
      exit.some((sample) => sample.bounds.bottom - sample.bounds.top < trace.height - 0.1),
      'Production zoom changes painted bounds while computed CSS height stays retained',
    );
    assert.ok(
      completion.at - trace.closeAt >= 60 && completion.at - trace.closeAt < 1000,
      'Observed exit is approximately 100ms (scheduler tolerance)',
    );
    assert.ok(
      trace.samples.slice(-2).every((sample) => !sample.mounted),
      'Popup detaches after actual completion',
    );
    assert.deepEqual(trace.listeners, { resize: 0, scroll: 0 }, 'Sizing listeners detach');
    if (trace.interrupted) {
      assert.ok(trace.opening, 'Closing interrupts an in-progress opening animation');
      assert.ok(!trace.completions.some((event) => event.open), 'Opening did not complete before the interrupted close');
    }
  };

  for (const lang of ['en', 'ar']) {
    await page.goto(`${APP}/?lang=${lang}`, { waitUntil: 'networkidle' });
    await page.getByRole('button').waitFor();
    await open(470, 96);
    await field.fill(lang === 'ar' ? 'البحث' : 'Search');
    await page.waitForFunction(() => document.querySelectorAll('[cmdk-item]').length === 30);
    await page.evaluate(() => document.fonts.ready);
    const reachability = await popup.evaluate((element) => {
      const last = element.querySelector('[cmdk-list] [cmdk-item]:last-child');
      last.scrollIntoView({ block: 'nearest' });
      const footer = element.querySelector('[role="switch"]').closest('label').parentElement;
      const list = element.querySelector('[cmdk-list]').parentElement;
      const bounds = (node) => {
        const r = node.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
      };
      return {
        box: window.readerExit.observe.snapshot(),
        footer: bounds(footer),
        last: bounds(last),
        list: bounds(list),
        scrollTop: list.scrollTop,
        clientHeight: list.clientHeight,
        scrollHeight: list.scrollHeight,
      };
    });
    assert.equal(reachability.box.direction, lang === 'ar' ? 'rtl' : 'ltr');
    assert.equal(reachability.box.cssTop, '96px');
    assert.equal(reachability.box.cssHeight, '470px');
    assert.ok(Math.abs(reachability.box.bounds.top - 96) < 1 && Math.abs(reachability.box.bounds.bottom - 566) < 1);
    assert.ok(Math.abs(reachability.box.bounds.left) < 1 && Math.abs(reachability.box.bounds.right - 390) < 1);
    assert.ok(reachability.scrollHeight > reachability.clientHeight && reachability.scrollTop > 0);
    assert.ok(
      reachability.last.top >= reachability.list.top - 1 && reachability.last.bottom <= reachability.list.bottom + 1,
      'Last result is reachable inside the scroller',
    );
    assert.ok(reachability.footer.top >= 96 && reachability.footer.bottom <= 567, 'Footer remains above synthetic keyboard');
    await page.screenshot({ path: `${output}/open-${lang}.png` });
    const normal = await closeTrace();
    checkTrace(normal);
    await open(530, 40);
    const reopened = await page.evaluate(() => window.readerExit.observe.snapshot());
    assert.equal(reopened.cssTop, '40px');
    assert.equal(reopened.cssHeight, '530px');
    const fresh = await closeTrace({ height: 530, top: 40 });
    checkTrace(fresh);
    const interrupted = await closeTrace({ interrupted: true });
    checkTrace(interrupted);
    cases.push({ lang, reachability, reopened, normal, fresh, interrupted });
  }
  assert.deepEqual(errors, []);
  const browserIdentity = await page.evaluate(() => navigator.userAgent);
  const video = page.video();
  await context.close();
  await video.saveAs(`${output}/interaction.webm`);
  assert.deepEqual(attempted, []);
  await writeEvidenceJson(`${output}/checks.json`, {
    result: 'PASS: all assertions in browser.mjs completed',
    sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceHashes,
    browser: browserIdentity,
    motion: 'no-preference; production 100ms animations',
    viewport: { width: 390, height: 844, scale: 1 },
    cases,
    nonLocalAttempts: attempted,
    limitations: ['Synthetic visualViewport; no actual phone, native keyboard, Safari, panning, pinch zoom or rotation acceptance.'],
  });
});
console.log('PASS: EN/LTR and AR/RTL; six real exits, fresh reopening, interrupted openings, footer/last result; 0 non-local attempts');
