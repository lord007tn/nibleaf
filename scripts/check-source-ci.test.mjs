import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { checkSourceCi, requiredWorkflows } from './check-source-ci.mjs';

const sha = 'a'.repeat(40);
const run = { id: 42, head_sha: sha, event: 'push', status: 'completed', conclusion: 'success' };
const options = (runs) => ({ repository: 'lord007tn/nibleaf', sha, token: 'fixture', fetchImpl: async () => Response.json({ workflow_runs: runs }) });

test('accepts exact-SHA successful source runs and returns a dry-run receipt', async () => {
  const receipts = await checkSourceCi(options([run]));
  assert.deepEqual(
    receipts.map((receipt) => receipt.workflow),
    requiredWorkflows,
  );
  assert.ok(receipts.every((receipt) => receipt.sha === sha && receipt.conclusion === 'success'));
});

for (const candidate of [
  { ...run, conclusion: 'failure' },
  { ...run, conclusion: 'cancelled' },
  { ...run, conclusion: 'skipped' },
  { ...run, status: 'in_progress', conclusion: null },
  { ...run, head_sha: 'b'.repeat(40) },
  { ...run, event: 'workflow_dispatch' },
]) {
  test(`rejects ${candidate.status}/${candidate.conclusion}/${candidate.event}/${candidate.head_sha[0]}`, async () => {
    await assert.rejects(checkSourceCi(options([candidate])), /Source CI/);
  });
}
test('rejects missing checks and a newer failed attempt after a passing run', async () => {
  await assert.rejects(checkSourceCi(options([])), /missing exact-SHA/);
  await assert.rejects(checkSourceCi(options([run, { ...run, id: 43, conclusion: 'failure' }])), /failure/);
});
test('fails closed on unauthorized, failed and malformed lookups', async () => {
  for (const status of [401, 403, 500]) {
    await assert.rejects(checkSourceCi({ ...options([]), fetchImpl: async () => new Response('', { status }) }), new RegExp(`HTTP ${status}`));
  }
  await assert.rejects(
    checkSourceCi({
      ...options([]),
      fetchImpl: async () => {
        throw new Error('network unavailable');
      },
    }),
    /network unavailable/,
  );
  await assert.rejects(checkSourceCi({ ...options([]), fetchImpl: async () => Response.json({}) }), /Invalid source CI/);
});
test('publication and deployment both run the gate before side effects; Docker remains manual', async () => {
  const workflow = await readFile('.github/workflows/docker.yml', 'utf8');
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /if: inputs.publish \|\| inputs.deploy[\s\S]*run: node scripts\/check-source-ci.mjs/);
  assert.ok(workflow.indexOf('run: node scripts/check-source-ci.mjs') < workflow.indexOf('uses: docker/build-push-action'));
  assert.ok(workflow.indexOf('run: node scripts/check-source-ci.mjs') < workflow.indexOf('uses: docker/login-action'));
  assert.doesNotMatch(workflow, /^ {2}(push|pull_request):/m);
});
