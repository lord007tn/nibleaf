import assert from 'node:assert/strict';
import { test } from 'node:test';
import { legacySuites, validateLegacyTarget } from './legacy-schema-compat.mjs';

test('legacy harness refuses other services and unowned databases', () => {
  assert.doesNotThrow(() => validateLegacyTarget('postgresql://fixture:fixture@127.0.0.1:5562/orgs_legacy_test'));
  for (const url of [
    'postgresql://127.0.0.1:5432/orgs_legacy_test',
    'postgresql://example.com:5562/orgs_legacy_test',
    'postgresql://127.0.0.1:5562/nibleaf',
  ]) {
    assert.throws(() => validateLegacyTarget(url));
  }
});
test('legacy suite inventory includes all eight requested gates', () => {
  assert.equal(legacySuites.length, 8);
  assert.equal(new Set(legacySuites.map(([, , gate]) => gate)).size, 8);
});
test('rollback scenario covers every council case and runs between the new-release phases', async () => {
  const { readFileSync } = await import('node:fs');
  const fixture = readFileSync(new URL('./legacy-rollback-scenario.fixture', import.meta.url), 'utf8');
  for (const name of [
    'demote, then roll back',
    'remove from the website, then roll back',
    'create a website, then roll back',
    'delete a website, then roll back',
  ])
    assert.match(fixture, new RegExp(name));
  const harness = readFileSync(new URL('./legacy-schema-compat.mjs', import.meta.url), 'utf8');
  const order = ['legacy-rollback-setup.postgres.test.ts', 'legacy-rollback-scenario.test.ts', 'legacy-schema-compat.postgres.test.ts'].map((file) =>
    harness.indexOf(file, harness.indexOf('legacySuites)')),
  );
  assert.ok(order.every((index) => index > 0) && order[0] < order[1] && order[1] < order[2], `phase order ${order}`);
});
