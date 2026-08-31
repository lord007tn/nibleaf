import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyTarget } from './coolify-release-probes.mjs';

const revision = 'a'.repeat(40);
const response = (body, responseRevision = revision) =>
  Response.json(body, { headers: responseRevision === null ? {} : { 'x-nibleaf-revision': responseRevision } });

test('API health accepts its real body contract and proves revision through the response header', async () => {
  await assert.doesNotReject(() =>
    verifyTarget({ name: 'api', url: 'https://nibleaf.com/api/app/health', revision: 'required' }, revision, false, async () =>
      response({ ok: true }),
    ),
  );
});

test('API health rejects an unsuccessful body even when the revision header matches', async () => {
  await assert.rejects(
    () =>
      verifyTarget({ name: 'api', url: 'https://nibleaf.com/api/app/health', revision: 'required' }, revision, false, async () =>
        response({ ok: false }),
      ),
    /API health body did not report ok: true/,
  );
});

test('app readiness still requires status and revision in its JSON body', async () => {
  await assert.doesNotReject(() =>
    verifyTarget({ name: 'app readiness', url: 'https://nibleaf.com/health', revision: 'required' }, revision, false, async () =>
      response({ status: 'ok', service: 'app', revision }),
    ),
  );
  await assert.rejects(
    () =>
      verifyTarget({ name: 'app readiness', url: 'https://nibleaf.com/health', revision: 'required' }, revision, false, async () =>
        response({ ok: true }),
      ),
    /App readiness body did not prove the expected revision/,
  );
});

test('separately published docs require reachability without pretending to prove the container revision', async () => {
  await assert.doesNotReject(() =>
    verifyTarget({ name: 'docs', url: 'https://docs.nibleaf.com/', revision: 'separate-publication' }, revision, false, async () =>
      response({}, null),
    ),
  );
});

test('image-backed surfaces reject a missing revision outside a bootstrap rollback', async () => {
  await assert.rejects(
    () => verifyTarget({ name: 'app', url: 'https://nibleaf.com/', revision: 'required' }, revision, false, async () => response({}, null)),
    /served revision missing/,
  );
});
