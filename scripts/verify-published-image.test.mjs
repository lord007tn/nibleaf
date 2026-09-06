import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { verifyPublishedImage } from './verify-published-image.mjs';

const digest = `sha256:${'a'.repeat(64)}`;
const input = { image: 'ghcr.io/example/image', digest, sourceSha: 'b'.repeat(40) };
const success = (value = digest) => ({ status: 0, stdout: `Name: image\nDigest: ${value}\nManifests:\n  Digest: sha256:${'c'.repeat(64)}\n` });

test('retries a transient inspect exit and verifies both immutable references', async () => {
  const references = [];
  const delays = [];
  const logs = [];
  await verifyPublishedImage(input, {
    run: (command, args) => {
      assert.equal(command, 'docker');
      references.push(args.at(-1));
      return references.length === 1 ? { status: 255, stderr: '' } : success();
    },
    wait: (delay) => delays.push(delay),
    log: (message) => logs.push(message),
  });
  assert.deepEqual(references, [`${input.image}@${digest}`, `${input.image}@${digest}`, `${input.image}:sha-${input.sourceSha}`]);
  assert.deepEqual(delays, [2000]);
  assert.match(logs[0], /exit 255.*No diagnostic output/u);
});

test('a tag mismatch fails immediately without retrying or accepting child digests', async () => {
  let calls = 0;
  await assert.rejects(
    verifyPublishedImage(input, { run: () => (++calls === 1 ? success() : success(`sha256:${'d'.repeat(64)}`)) }),
    /expected build digest/u,
  );
  assert.equal(calls, 2);
});

test('persistent inspect failure stops after three attempts', async () => {
  let calls = 0;
  const delays = [];
  await assert.rejects(
    verifyPublishedImage(input, {
      run: () => {
        calls++;
        return { status: 1, stderr: 'registry unavailable' };
      },
      wait: (delay) => delays.push(delay),
      log: () => undefined,
    }),
    /failed after 3 attempts/u,
  );
  assert.equal(calls, 3);
  assert.deepEqual(delays, [2000, 4000]);
});

test('missing or ambiguous top-level digest fails closed', async () => {
  for (const stdout of [`  Digest: ${digest}\n`, `Digest: ${digest}\nDigest: ${digest}\n`]) {
    await assert.rejects(verifyPublishedImage(input, { run: () => ({ status: 0, stdout }) }), /expected build digest/u);
  }
});

test('consumes all child stdout even when digest precedes a large manifest body', async () => {
  await verifyPublishedImage(input, {
    run: (_command, _args, options) => {
      const child = spawnSync(
        process.execPath,
        [
          '-e',
          `process.stdout.write(${JSON.stringify(`Digest: ${digest}\n`)}); process.stdout.write('x'.repeat(2 * 1024 * 1024)); process.stdout.write('COMPLETE');`,
        ],
        options,
      );
      assert.equal(child.status, 0);
      assert.ok(child.stdout.endsWith('COMPLETE'));
      return child;
    },
  });
});
