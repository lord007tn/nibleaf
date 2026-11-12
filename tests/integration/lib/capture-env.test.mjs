import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  acquireDevstackLock,
  allowedHostKey,
  browserFacade,
  hostKey,
  launchLocalOnlyBrowser,
  localHostKeys,
  localOnlyBrowserArgs,
  pageTools,
} from './capture-env.mjs';

// The guard's behaviour in a real browser (redirects, WebSockets, prefetch,
// favicons, harness routes) is covered by capture-network.browser.mjs.

describe('localOnlyBrowserArgs: Chromium keeps the network local', () => {
  it('fails every name but loopback, even with no custom domains, and routes the rest into a closed proxy', () => {
    assert.deepEqual(localOnlyBrowserArgs(), [
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
      '--proxy-server=127.0.0.1:9',
      '--proxy-bypass-list=localhost;127.0.0.1',
    ]);
  });

  it('maps each custom domain to the local app first, and lets only it bypass the closed proxy', () => {
    assert.deepEqual(localOnlyBrowserArgs({ 'Docs.Example.com': 4310 }), [
      '--host-resolver-rules=MAP docs.example.com 127.0.0.1:4310, MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1',
      '--proxy-server=127.0.0.1:9',
      '--proxy-bypass-list=localhost;127.0.0.1;docs.example.com',
    ]);
  });

  it('refuses a custom domain that is not a hostname, or has no local port', () => {
    assert.throws(() => localOnlyBrowserArgs({ '*': 4310 }), /must be a hostname/);
    assert.throws(() => localOnlyBrowserArgs({ 'docs.example.com, MAP *': 4310 }), /must be a hostname/);
    assert.throws(() => localOnlyBrowserArgs({ 'docs.example.com': 0 }), /needs a local port/);
  });
});

describe('host keys', () => {
  it('writes out the default port of the scheme', () => {
    assert.equal(hostKey('http://LOCALHOST/sites/x'), 'localhost:80');
    assert.equal(hostKey('http://localhost:80/'), 'localhost:80');
    assert.equal(hostKey('https://docs.example.com/'), 'docs.example.com:443');
    assert.equal(hostKey('wss://example.com/socket'), 'example.com:443');
    assert.equal(hostKey('http://localhost:4310/x'), 'localhost:4310');
    assert.equal(hostKey('not a url'), '');
  });

  it('allows only an explicit loopback name and port, never every interface', () => {
    assert.equal(allowedHostKey('LocalHost:04310'), 'localhost:4310');
    assert.equal(allowedHostKey('127.0.0.1:4410'), '127.0.0.1:4410');
    assert.throws(() => allowedHostKey('localhost'), /hostname:port/);
    assert.throws(() => allowedHostKey('0.0.0.0:4310'), /every interface/);
    assert.throws(() => allowedHostKey('http://localhost:4310'), /hostname:port/);
  });
});

describe('the dev-stack lock', () => {
  const listeners = () => ['exit', 'SIGINT', 'SIGTERM'].map((event) => process.listenerCount(event));
  const withLockPath = async (fn) => {
    const dir = mkdtempSync(join(tmpdir(), 'devstack-lock-test-'));
    const previous = process.env.NIBLEAF_DEVSTACK_LOCK;
    process.env.NIBLEAF_DEVSTACK_LOCK = join(dir, 'editor-devstack.lock');
    try {
      await fn(process.env.NIBLEAF_DEVSTACK_LOCK);
    } finally {
      if (previous === undefined) delete process.env.NIBLEAF_DEVSTACK_LOCK;
      else process.env.NIBLEAF_DEVSTACK_LOCK = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it('release() removes the lock and its handlers', async () => {
    await withLockPath(async (path) => {
      const before = listeners();
      const lock = await acquireDevstackLock('test');
      assert.ok(existsSync(path));
      await lock.release();
      assert.equal(existsSync(path), false);
      assert.deepEqual(listeners(), before);
    });
  });

  it('keep() leaves the lock in place: no handler removes it on exit, and release() does nothing', async () => {
    await withLockPath(async (path) => {
      const before = listeners();
      const lock = await acquireDevstackLock('test');
      assert.notDeepEqual(listeners(), before);
      lock.keep();
      assert.deepEqual(listeners(), before);
      await lock.release();
      assert.ok(existsSync(path));
    });
  });
});

describe('allowed hosts stay on this machine', () => {
  it('accepts loopback with a port, a mapped custom domain, and reserved fixture names', () => {
    assert.deepEqual(
      localHostKeys(['localhost:4310', '127.0.0.1:4410', 'docs.example.com:80', 'harness.test:80', 'site.invalid:80'], { 'docs.example.com': 4310 }),
      ['localhost:4310', '127.0.0.1:4410', 'docs.example.com:80', 'harness.test:80', 'site.invalid:80'],
    );
  });

  it('refuses a host from a production APP_URL, a domain that is not mapped, or a LAN name', () => {
    assert.throws(() => localHostKeys([hostKey('https://nibleaf.com')]), /isn't on this machine/);
    assert.throws(() => localHostKeys(['docs.joodbooking.com:80']), /isn't on this machine/);
    assert.throws(() => localHostKeys(['fixture.local:80']), /isn't on this machine/);
  });

  it('throws before any browser launches', async () => {
    await assert.rejects(launchLocalOnlyBrowser({ allowedHosts: [hostKey('https://nibleaf.com/app')] }), /isn't on this machine/);
  });
});

describe('browserFacade: what a capture script gets instead of the browser', () => {
  const raw = {
    closed: false,
    newContext: () => {
      throw new Error('raw newContext must not be reachable');
    },
    newBrowserCDPSession: () => {
      throw new Error('raw CDP must not be reachable');
    },
    contexts: () => [],
    close: async () => {
      raw.closed = true;
    },
  };
  const guarded = [];
  const facade = browserFacade(raw, async (options) => {
    const page = {
      listeners: {},
      on: (event, listener) => {
        page.listeners[event] = listener;
      },
    };
    const context = {
      options,
      closed: false,
      newPage: async () => page,
      close: async () => {
        context.closed = true;
      },
    };
    guarded.push(context);
    return context;
  });

  it('offers only guarded newContext, newPage and close: no CDP, no prototype, frozen', () => {
    assert.deepEqual(Object.keys(facade).sort(), ['close', 'newContext', 'newPage']);
    assert.equal('newBrowserCDPSession' in facade, false);
    assert.equal('contexts' in facade, false);
    assert.equal(Object.getPrototypeOf(facade), null);
    assert.ok(Object.isFrozen(facade));
  });

  it('opens contexts and pages only through the guard, and closes a page context with its page', async () => {
    await facade.newContext({ locale: 'ar' });
    const page = await facade.newPage({ viewport: { width: 390, height: 844 } });
    assert.deepEqual(
      guarded.map((context) => context.options),
      [{ locale: 'ar' }, { viewport: { width: 390, height: 844 } }],
    );
    page.listeners.close();
    await Promise.resolve();
    assert.equal(guarded[1]?.closed, true);
    await facade.close();
    assert.equal(raw.closed, true);
  });
});

describe('no capture launches Chromium around the guard', () => {
  it('finds chromium.launch and launchPersistentContext only in capture-env.mjs and the product PDF export', () => {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
    let found = '';
    try {
      found = execFileSync('git', ['grep', '-nE', String.raw`chromium\.launch\(|launchPersistentContext\(`, '--', '.'], {
        cwd: root,
        encoding: 'utf8',
      });
    } catch (error) {
      // git grep exits 1 when nothing matches.
      if (error.status !== 1) throw error;
    }
    const allowed = new Set([
      'tests/integration/lib/capture-env.mjs',
      'tests/integration/lib/capture-env.test.mjs',
      'apps/worker/src/exports/pdf.ts',
    ]);
    const offenders = found
      .split('\n')
      .filter(Boolean)
      .filter((line) => !allowed.has(line.slice(0, line.indexOf(':'))));
    assert.deepEqual(offenders, [], 'launch Chromium through withLocalOnlyBrowser (tests/integration/lib/capture-env.mjs)');
  });
});

describe('pageTools: the only DevTools a capture gets', () => {
  const sent = [];
  const listeners = [];
  const session = {
    send: async (method, params) => {
      sent.push([method, params]);
      return {};
    },
    on: (event) => listeners.push(event),
    detach: async () => undefined,
  };
  const tools = pageTools(session);

  it('passes CPU throttling, screencast and IME input through', async () => {
    await tools.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await tools.send('Page.startScreencast', { format: 'jpeg' });
    await tools.send('Page.screencastFrameAck', { sessionId: 1 });
    await tools.send('Page.stopScreencast');
    await tools.send('Input.imeSetComposition', { text: 'か' });
    await tools.send('Input.insertText', { text: '課' });
    tools.on('Page.screencastFrame', () => undefined);
    assert.equal(sent.length, 6);
    assert.deepEqual(listeners, ['Page.screencastFrame']);
  });

  it('refuses anything that could open a target or context or touch the network', async () => {
    for (const method of ['Target.createTarget', 'Target.createBrowserContext', 'Network.enable', 'Fetch.enable', 'Runtime.evaluate']) {
      await assert.rejects(tools.send(method, {}), /not available in captures/, method);
    }
    assert.throws(() => tools.on('Target.attachedToTarget', () => undefined), /not available in captures/);
    assert.equal(sent.length, 6);
  });

  it('keeps the raw session out of reach', () => {
    assert.deepEqual(Object.keys(tools).sort(), ['detach', 'on', 'send']);
    assert.equal(Object.getPrototypeOf(tools), null);
    assert.ok(Object.isFrozen(tools));
  });
});
