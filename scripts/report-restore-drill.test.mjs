import assert from 'node:assert/strict';
import test from 'node:test';
import { reportRestoreFailure } from './report-restore-drill.mjs';

const input = { repository: 'example/docs', runUrl: 'https://example.test/run/123', log: 'synthetic failure' };
for (const state of ['OPEN', 'CLOSED']) {
  test(`comments on the exact tracking title (${state}) instead of opening another issue`, () => {
    const calls = [];
    const gh = (args, body) => {
      calls.push({ args, body });
      return JSON.stringify([
        { number: 1, title: 'Self-host restore drill failures elsewhere', state: 'OPEN' },
        { number: 2, title: 'Self-host restore drill failures', state },
      ]);
    };
    reportRestoreFailure(input, gh);
    assert.equal(
      calls.some(({ args }) => args[1] === 'create'),
      false,
    );
    assert.equal(
      calls.some(({ args }) => args[1] === 'reopen'),
      state === 'CLOSED',
    );
    const comment = calls.find(({ args }) => args[1] === 'comment');
    assert.equal(comment.args[2], '2');
    assert.match(comment.body, /synthetic failure/);
    assert.match(comment.body, /https:\/\/example.test\/run\/123/);
  });
}
test('creates one tracking issue when no exact title exists, preserving failure output', () => {
  const calls = [];
  reportRestoreFailure(input, (args, body) => {
    calls.push({ args, body });
    return '[]';
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].args[1], 'create');
  assert.match(calls[1].body, /synthetic failure/);
});
