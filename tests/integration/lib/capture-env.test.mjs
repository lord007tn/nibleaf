import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { acquireDevstackLock, allowedHostKey, hostKey, localOnlyBrowserArgs } from './capture-env.mjs';

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
