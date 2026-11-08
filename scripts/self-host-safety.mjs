import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

/** Refuse both running projects and retained data before any owned cleanup. */
export function assertUnusedProject(project, exec = execFileSync) {
  const filter = `label=com.docker.compose.project=${project}`;
  for (const args of [
    ['ps', '-aq', '--filter', filter],
    ['volume', 'ls', '-q', '--filter', filter],
  ]) {
    assert.equal(exec('docker', args, { encoding: 'utf8' }).trim(), '', `Refusing to reuse existing ${project} containers or volumes`);
  }
}
