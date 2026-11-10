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
