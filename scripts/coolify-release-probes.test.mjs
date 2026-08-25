import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyTarget } from './coolify-release-probes.mjs';

const revision = 'a'.repeat(40);
const response = (body, responseRevision = revision) =>
  Response.json(body, { headers: responseRevision === null ? {} : { 'x-nibleaf-revision': responseRevision } });

test('API health accepts its real body contract and proves revision through the response header', async () => {
  await assert.doesNotReject(() => verifyTarget(['api', 'https://nibleaf.com/api/app/health'], revision, false, async () => response({ ok: true })));
});

test('API health rejects an unsuccessful body even when the revision header matches', async () => {
  await assert.rejects(
    () => verifyTarget(['api', 'https://nibleaf.com/api/app/health'], revision, false, async () => response({ ok: false })),
    /API health body did not report ok: true/,
  );
});

test('app readiness still requires status and revision in its JSON body', async () => {
  await assert.doesNotReject(() =>
    verifyTarget(['app readiness', 'https://nibleaf.com/health'], revision, false, async () => response({ status: 'ok', service: 'app', revision })),
  );
  await assert.rejects(
    () => verifyTarget(['app readiness', 'https://nibleaf.com/health'], revision, false, async () => response({ ok: true })),
    /App readiness body did not prove the expected revision/,
  );
});
