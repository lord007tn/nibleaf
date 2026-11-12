import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { localHostArgs, localOnlyNetwork } from './capture-env.mjs';

/** A browser context that keeps the route handler, and routes that record what was done with them. */
const fakeContext = () => {
  const context = {
    handler: undefined,
    route: async (_pattern, handler) => {
      context.handler = handler;
    },
  };
  return context;
};
const request = (url, method = 'GET') => {
  const route = {
    outcome: undefined,
    request: () => ({ url: () => url, method: () => method }),
    continue: () => {
      route.outcome = 'continued';
    },
    abort: (reason) => {
      route.outcome = `aborted:${reason}`;
    },
  };
  return route;
};

describe('localOnlyNetwork: default-deny network for captures', () => {
  it('lets only the allowed local hosts through', async () => {
    const context = fakeContext();
    const network = await localOnlyNetwork(context, ['localhost:4310', 'LOCALHOST:4410']);
    const allowed = [request('http://localhost:4310/sites/x'), request('http://localhost:4410/api/public/sites/x')];
    for (const route of allowed) context.handler(route);
    assert.deepEqual(
      allowed.map((route) => route.outcome),
      ['continued', 'continued'],
    );
    assert.deepEqual(network.attempted, []);
    network.assertNoneAttempted();
  });

  it('aborts and records everything else: production, a custom domain over HTTPS, another local port, third parties', async () => {
    const context = fakeContext();
    const network = await localOnlyNetwork(context, ['localhost:4310']);
    const blocked = [
      request('https://docs.example.com/guide'),
      request('https://nibleaf.com/api/public/sites/x/events', 'POST'),
      request('http://localhost:4311/api/app/health'),
      request('https://cdn.example.net/script.js'),
      request('not a url'),
    ];
    for (const route of blocked) context.handler(route);
    assert.ok(blocked.every((route) => route.outcome === 'aborted:blockedbyclient'));
    assert.equal(network.attempted.length, 5);
    assert.equal(network.attempted[1], 'POST https://nibleaf.com/api/public/sites/x/events');
    assert.throws(() => network.assertNoneAttempted(), /outside the local stack/);
  });
});

describe('localHostArgs: custom domains served by the local app', () => {
  it('maps each host to the local port', () => {
    assert.deepEqual(localHostArgs({ 'Docs.Example.com': 4310, 'help.example.org': 4310 }), [
      '--host-resolver-rules=MAP docs.example.com 127.0.0.1:4310,MAP help.example.org 127.0.0.1:4310',
    ]);
    assert.deepEqual(localHostArgs({}), []);
  });
});
