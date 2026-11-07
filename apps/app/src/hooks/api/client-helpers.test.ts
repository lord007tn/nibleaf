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

it('keeps the structured details and exposes a named reason', async () => {
  const response = Response.json(
    {
      error: {
        code: 'domain:already_connected',
        message: 'Taken',
        details: { reason: 'scope', scope: 'same_workspace', siteName: 'Docs', demoted: true },
      },
    },
    { status: 409 },
  );
  const error = await mutateData(response, 'Could not add the domain.').catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(ApiResponseError);
  expect(error).toMatchObject({ code: 'domain:already_connected', details: { scope: 'same_workspace', siteName: 'Docs', demoted: true } });
  expect((error as ApiResponseError).reason).toBe('scope');
});

it('has no reason when the server sends none, or sends one that is not text', async () => {
  expect(new ApiResponseError('x', 409, 'c').reason).toBeUndefined();
  expect(new ApiResponseError('x', 409, 'c', undefined, undefined, undefined, undefined, { reason: 7 }).reason).toBeUndefined();
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
