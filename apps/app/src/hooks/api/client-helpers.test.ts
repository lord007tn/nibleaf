import { expect, it } from 'vitest';
import { getData, mutateData } from './client-helpers';

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

it.each(['site_disabled', 'instance_disabled'])('retains the AI disable reason %s in mutation errors', async (reason) => {
  const response = Response.json({ error: { code: 'ai:disabled', details: { reason } } }, { status: 403 });
  await expect(mutateData(response, 'Draft failed')).rejects.toMatchObject({ code: 'ai:disabled', reason });
});
it('retains error reasons in query failures', async () => {
  const response = Response.json({ error: { code: 'ai:disabled', details: { reason: 'instance_disabled' } } }, { status: 403 });
  await expect(getData(response, 'AI capability')).rejects.toMatchObject({ code: 'ai:disabled', reason: 'instance_disabled' });
});
