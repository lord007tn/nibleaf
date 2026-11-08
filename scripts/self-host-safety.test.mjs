import assert from 'node:assert/strict';
import test from 'node:test';
import { assertUnusedProject } from './self-host-safety.mjs';

test('smoke/restore preflight refuses containers, retained volumes and failed inspection', () => {
  for (const occupied of ['ps', 'volume']) {
    const calls = [];
    assert.throws(
      () =>
        assertUnusedProject('nibleaf-selfhost', (_command, args) => {
          calls.push(args);
          return args[0] === occupied ? 'retained-fixture\n' : '';
        }),
      /Refusing to reuse/,
    );
    assert.ok(calls.every((args) => !args.includes('down') && !args.includes('rm')));
  }
  assert.throws(
    () =>
      assertUnusedProject('nibleaf-selfhost', () => {
        throw new Error('inspection failed');
      }),
    /inspection failed/,
  );
  assert.doesNotThrow(() => assertUnusedProject('nibleaf-selfhost', () => ''));
});
