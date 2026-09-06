import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeCoolifyLiteral } from './coolify-env-literal.mjs';

test('normalizes one provider-added quote pair around an immutable image tag', () => {
  const tag = 'sha-583680a3627bc7e2e8fe54379987ade70c20bc3e';
  assert.equal(normalizeCoolifyLiteral(`'${tag}'`), tag);
  assert.equal(normalizeCoolifyLiteral(` "${tag}" `), tag);
  assert.equal(normalizeCoolifyLiteral(tag), tag);
});

test('does not reinterpret unmatched or embedded quotes', () => {
  assert.equal(normalizeCoolifyLiteral("'sha-value"), "'sha-value");
  assert.equal(normalizeCoolifyLiteral("sha-'value'"), "sha-'value'");
  assert.equal(normalizeCoolifyLiteral(undefined), undefined);
});
