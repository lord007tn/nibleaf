import { expect, it } from 'vitest';
import { mutateData } from './client-helpers';

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

it('keeps the server reason so a specific case can get its own message', async () => {
  const response = Response.json(
    { error: { code: 'database:conflict', message: 'Pages changed', details: { reason: 'promote_raced' } } },
    { status: 409 },
  );
  await expect(mutateData(response, 'Promote failed')).rejects.toMatchObject({ status: 409, code: 'database:conflict', reason: 'promote_raced' });
});
