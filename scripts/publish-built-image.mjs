import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Publish a locally built OCI archive without rebuilding after the CI gate. */
export function publishBuiltImage({ image, sha, tag, archive }, exec = execFileSync) {
  if (
    !/^ghcr\.io\/[\w.-]+\/[\w.-]+$/.test(image ?? '') ||
    !/^[0-9a-f]{40}$/.test(sha ?? '') ||
    !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,127}$/.test(tag ?? '') ||
    !archive
  )
    throw new Error('Invalid image publication inputs');
  for (const target of new Set([`sha-${sha}`, tag])) {
    const authfile = join(process.env.DOCKER_CONFIG ?? join(homedir(), '.docker'), 'config.json');
    exec('skopeo', ['copy', '--all', '--preserve-digests', '--authfile', authfile, `oci-archive:${archive}`, `docker://${image}:${target}`], {
      stdio: 'inherit',
    });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  publishBuiltImage({ image: process.env.IMAGE, sha: process.env.SOURCE_SHA, tag: process.env.TAG, archive: process.env.OCI_ARCHIVE });
}
