import { expect, it } from 'vitest';
import { ApiResponseError, getData, mutateData } from './client-helpers';

it('preserves the missing source path and including page from the app error envelope', async () => {
  const response = new Response(
    JSON.stringify({
      error: { code: 'import:incomplete', message: 'Missing source', details: { path: '../includes/missing.md', sourceFile: 'guides/start.md' } },
    }),
    { status: 422 },
  );
  await expect(mutateData(response, 'Import failed')).rejects.toMatchObject({
    code: 'import:incomplete',
    path: '../includes/missing.md',
    sourceFile: 'guides/start.md',
  });
});

it('retains the concrete navigation limit for the localized import error', async () => {
  const response = Response.json({ error: { code: 'import:limit', message: 'Navigation limit', details: { limit: 500 } } }, { status: 422 });
  await expect(mutateData(response, 'Import failed')).rejects.toMatchObject({ code: 'import:limit', limit: 500 });
});

it('keeps the server details and reads their reason', async () => {
  const response = Response.json(
    { error: { code: 'database:not_found', message: 'site not found', details: { reason: 'private', identifier: 'docs' } } },
    { status: 404 },
  );
  const error = await getData(response, 'site').catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ApiResponseError);
  expect(error).toMatchObject({ status: 404, reason: 'private', details: { reason: 'private', identifier: 'docs' } });
  expect(new ApiResponseError('x', 404, undefined, undefined, undefined, undefined, undefined, { reason: 7 }).reason).toBeUndefined();
});

it.each([
  ['getData', getData],
  ['mutateData', mutateData],
] as const)('keeps the details and reason of a validation error (%s)', async (_name, read) => {
  const details = { reason: 'fixture', errors: [{ path: 'query', message: 'is too long' }] };
  const response = Response.json({ error: { code: 'validation:failed', message: 'Invalid request', details } }, { status: 422 });
  const error = await read(response, 'request').catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ApiResponseError);
  expect(error).toMatchObject({ status: 422, message: 'Invalid request query: is too long', reason: 'fixture', details });
});

it.each(['site_disabled', 'instance_disabled'])('retains the AI disable reason %s in mutation errors', async (reason) => {
  const response = Response.json({ error: { code: 'ai:disabled', details: { reason } } }, { status: 403 });
  await expect(mutateData(response, 'Draft failed')).rejects.toMatchObject({ code: 'ai:disabled', reason });
});
it('retains error reasons in query failures', async () => {
  const response = Response.json({ error: { code: 'ai:disabled', details: { reason: 'instance_disabled' } } }, { status: 403 });
  await expect(getData(response, 'AI capability')).rejects.toMatchObject({ code: 'ai:disabled', reason: 'instance_disabled' });
});
