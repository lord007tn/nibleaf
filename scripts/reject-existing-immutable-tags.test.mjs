import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { rejectExistingImmutableTags } from './reject-existing-immutable-tags.mjs';

const input = { image: 'ghcr.io/owner/repo', sourceSha: 'a'.repeat(40), tag: 'latest', username: 'actor', token: 'secret-fixture' };
const reply = (status, body) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
const auth = () => reply(200, { token: 'bearer-fixture' });
const access = () => reply(200, { name: 'owner/repo', tags: ['latest'] });
const absent = () => reply(404, { errors: [{ code: 'MANIFEST_UNKNOWN' }] });
const harness = (responses) => {
  const calls = [];
  const delays = [];
  return {
    calls,
    delays,
    dependencies: {
      fetch: async (url, options) => {
        calls.push({ url, options });
        assert.ok(responses.length, 'unexpected extra request');
        const response = responses.shift();
        if (response instanceof Error) throw response;
        return response;
      },
      wait: async (delay) => {
        delays.push(delay);
      },
    },
  };
};

test('authenticated repository access plus MANIFEST_UNKNOWN permits SHA and version tags', async () => {
  const mock = harness([auth(), access(), absent(), absent()]);
  await rejectExistingImmutableTags({ ...input, tag: 'v1.2.3' }, mock.dependencies);
  assert.equal(mock.calls.length, 4);
  assert.match(mock.calls[0].url, /scope=repository%3Aowner%2Frepo%3Apull$/u);
  assert.equal(mock.calls[1].url, 'https://ghcr.io/v2/owner/repo/tags/list?n=1');
  assert.match(mock.calls[2].url, /manifests\/sha-a{40}$/u);
  assert.match(mock.calls[3].url, /manifests\/v1\.2\.3$/u);
  for (const { url, options } of mock.calls) {
    assert.ok(!url.includes('fixture'));
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
  }
  assert.equal(mock.calls[1].options.headers.Authorization, 'Bearer bearer-fixture');
});

test('existing SHA or version tag rejects even if response body is malformed', async () => {
  for (const responses of [
    [auth(), access(), reply(200, 'not JSON')],
    [auth(), access(), absent(), reply(200, {})],
  ]) {
    const mock = harness(responses);
    await assert.rejects(rejectExistingImmutableTags({ ...input, tag: 'v1' }, mock.dependencies), /already exists/u);
  }
});

test('token or repository access failures never reach manifest lookup', async () => {
  for (const response of [reply(401, {}), reply(403, {}), reply(404, {}), reply(200, {}), reply(200, 'bad JSON')]) {
    const mock = harness([response]);
    await assert.rejects(rejectExistingImmutableTags(input, mock.dependencies));
    assert.equal(mock.calls.length, 1);
  }
  for (const response of [
    reply(401, {}),
    reply(403, {}),
    reply(404, {}),
    reply(200, { name: 'other/repo', tags: [] }),
    reply(200, { name: 'owner/repo', tags: null }),
  ]) {
    const mock = harness([auth(), response]);
    await assert.rejects(rejectExistingImmutableTags(input, mock.dependencies));
    assert.equal(mock.calls.length, 2);
  }
});

test('denied, unknown, redirect, and malformed missing responses fail closed without retries', async () => {
  for (const response of [
    reply(401, {}),
    reply(403, {}),
    reply(302, {}),
    new Response(null, { status: 204 }),
    reply(404, 'not JSON'),
    reply(404, {}),
    reply(404, { errors: [] }),
    reply(404, { errors: [{ code: 'NAME_UNKNOWN' }] }),
    reply(404, { errors: [{ code: 'MANIFEST_UNKNOWN' }, { code: 'DENIED' }] }),
  ]) {
    const mock = harness([auth(), access(), response]);
    await assert.rejects(rejectExistingImmutableTags(input, mock.dependencies));
    assert.equal(mock.calls.length, 3);
    assert.deepEqual(mock.delays, []);
  }
});

test('transient HTTP and network errors retry, then permit only authoritative absence', async () => {
  for (const transient of [() => reply(429, {}), () => reply(503, {}), () => new Error('secret-fixture network detail')]) {
    const mock = harness([auth(), access(), transient(), transient(), absent()]);
    await rejectExistingImmutableTags(input, mock.dependencies);
    assert.equal(mock.calls.length, 5);
    assert.deepEqual(mock.delays, [2000, 4000]);
    const exhausted = harness([auth(), access(), transient(), transient(), transient()]);
    await assert.rejects(rejectExistingImmutableTags(input, exhausted.dependencies), (error) => {
      assert.match(error.message, /after 3 attempts/u);
      assert.ok(!error.message.includes('secret-fixture'));
      return true;
    });
    assert.deepEqual(exhausted.delays, [2000, 4000]);
  }
});

test('invalid inputs cannot send credentials to another origin or make requests', async () => {
  for (const override of [
    { image: 'https://evil.test/owner/repo' },
    { image: 'ghcr.io/owner/../repo' },
    { sourceSha: 'bad' },
    { tag: 'bad/tag' },
    { token: '' },
  ]) {
    const mock = harness([]);
    await assert.rejects(rejectExistingImmutableTags({ ...input, ...override }, mock.dependencies));
    assert.equal(mock.calls.length, 0);
  }
});

test('manual workflow invokes the guard before publishing with header-only credentials', () => {
  const workflow = readFileSync(new URL('../.github/workflows/docker.yml', import.meta.url), 'utf8');
  assert.match(workflow, /workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /^\s+(?:pull_request|push):\s*$/mu);
  const guard = workflow.indexOf('node scripts/reject-existing-immutable-tags.mjs');
  assert.ok(guard > 0 && guard < workflow.indexOf('- name: Build and publish'));
  assert.match(workflow, /GHCR_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/u);
});
