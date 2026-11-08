import assert from 'node:assert/strict';
import test from 'node:test';
import { publishBuiltImage } from './publish-built-image.mjs';

test('publishes the same archive to immutable and chosen tags without rebuilding', () => {
  const calls = [];
  const options = { image: 'ghcr.io/fixture/project', sha: 'a'.repeat(40), tag: 'next', archive: '/tmp/fixture.tar' };
  publishBuiltImage(options, (...args) => calls.push(args));
  assert.equal(calls.length, 2);
  assert.ok(
    calls.every(
      ([command, args]) =>
        command === 'skopeo' && args.includes('--all') && args.includes('--preserve-digests') && args.includes('oci-archive:/tmp/fixture.tar'),
    ),
  );
  assert.equal(calls[0][1].at(-1), `docker://${options.image}:sha-${options.sha}`);
  assert.equal(calls[1][1].at(-1), `docker://${options.image}:next`);
  assert.throws(() => publishBuiltImage({ ...options, tag: '; injected' }, () => assert.fail()), /Invalid/);
});
