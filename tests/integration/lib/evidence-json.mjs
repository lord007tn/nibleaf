import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');

/** Format with repository settings even when capture output is outside Git or ignored. */
export async function writeEvidenceJson(file, evidence) {
  const formatted = execFileSync(
    process.execPath,
    [resolve(root, 'node_modules/@biomejs/biome/bin/biome'), 'format', '--stdin-file-path=evidence.json'],
    {
      cwd: root,
      input: JSON.stringify(evidence),
      encoding: 'utf8',
      // All-locale runs can include thousands of leftover-text observations.
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  await writeFile(file, formatted);
}
