import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { writeEvidenceJson } from './evidence-json.mjs';

test('capture evidence uses repository JSON formatting without changing observations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nibleaf-evidence-json-'));
  assert.equal(dirname(directory), tmpdir());
  try {
    const file = join(directory, 'evidence.json');
    const evidence = { sizes: ['1440×1000', '390×844 touch'], attempted: 0, captures: [{ locale: 'ar', text: 'مؤسسة', errors: [] }] };
    await writeEvidenceJson(file, evidence);
    const text = await readFile(file, 'utf8');
    assert.deepEqual(JSON.parse(text), evidence);
    // JSON.stringify(..., null, 2) splits this array; Biome requires one line.
    assert.ok(text.includes('"sizes": ["1440×1000", "390×844 touch"]'));
    assert.ok(text.endsWith('\n'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
