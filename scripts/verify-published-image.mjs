import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

// Buffer the complete response before parsing: an early-exiting pipeline reader
// can close Docker's stdout while it is still writing manifest details.
const inspectImage = async (reference, { run = spawnSync, wait = setTimeout, log = console.error } = {}) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const result = run('docker', ['buildx', 'imagetools', 'inspect', reference], {
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    if (!result.error && result.status === 0) return result.stdout;
    const detail = result.error?.message || result.stderr?.trim() || 'No diagnostic output';
    log(`Registry inspect attempt ${attempt}/3 failed for ${reference} (exit ${result.status}, signal ${result.signal ?? 'none'}): ${detail}`);
    if (attempt < 3) await wait(attempt * 2000);
  }
  throw new Error(`Registry inspect failed after 3 attempts for ${reference}`);
};

export const verifyPublishedImage = async ({ image, digest, sourceSha }, dependencies) => {
  if (!/^sha256:[0-9a-f]{64}$/u.test(digest ?? '')) throw new Error('Build did not return a registry digest');
  if (!/^[0-9a-f]{40}$/u.test(sourceSha ?? '')) throw new Error('Source must be a full Git revision');
  if (!image || /\s/u.test(image)) throw new Error('Image repository is required');
  for (const reference of [`${image}@${digest}`, `${image}:sha-${sourceSha}`]) {
    const output = await inspectImage(reference, dependencies);
    // Only the top-level digest counts, never an indented child manifest digest.
    const digests = [...output.matchAll(/^Digest:\s+(sha256:[0-9a-f]{64})\s*$/gmu)].map((match) => match[1]);
    if (digests.length !== 1 || digests[0] !== digest) {
      throw new Error(`Image ${reference} resolved to ${digests.join(', ') || 'no valid top-level digest'}, expected build digest ${digest}`);
    }
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { IMAGE: image, DIGEST: digest, SOURCE_SHA: sourceSha } = process.env;
    await verifyPublishedImage({ image, digest, sourceSha });
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `### Published image\n- Source: \`${sourceSha}\`\n- Immutable tag: \`sha-${sourceSha}\`\n- Digest: \`${digest}\`\n`,
      );
    }
  } catch (error) {
    console.error(`Image verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
