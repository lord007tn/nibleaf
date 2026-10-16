import { Readable } from 'node:stream';
import { getObjectStream } from '@nibleaf/storage';
import { createExportBody, createExportScheduleBody, updateExportScheduleBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import {
  cancelExport,
  createExport,
  createExportSchedule,
  deleteExportSchedule,
  getExport,
  getExportDownload,
  getExportDownloadArtifact,
  listExportSchedules,
  listExports,
  runExportSchedule,
  updateExportSchedule,
} from '@/actions/exports';
import { logPlatformEvent } from '@/actions/platform-events';
import { exportFileResponseHeaders } from '@/lib/export-file-response';
import { getContextUserOrThrow, type HonoEnv } from '@/lib/hono/context';
import { validator } from '@/lib/hono/validate';
import routes from './routes';

const app = new Hono<HonoEnv>()
  .get('/', ...routes.list, async (ctx) => ctx.json({ data: await listExports(ctx.req.param('projectId') ?? '') }, 200))
  .post('/', ...routes.create, validator('json', createExportBody), async (ctx) => {
    const user = getContextUserOrThrow();
    return ctx.json({ data: await createExport(ctx.req.param('projectId') ?? '', user.id, ctx.req.valid('json').formats) }, 201);
  })
  .get('/schedules', ...routes.schedules, async (ctx) => ctx.json({ data: await listExportSchedules(ctx.req.param('projectId') ?? '') }, 200))
  .post('/schedules', ...routes.createSchedule, validator('json', createExportScheduleBody), async (ctx) => {
    const user = getContextUserOrThrow();
    return ctx.json({ data: await createExportSchedule(ctx.req.param('projectId') ?? '', user.id, ctx.req.valid('json')) }, 201);
  })
  .patch('/schedules/:scheduleId', ...routes.updateSchedule, validator('json', updateExportScheduleBody), async (ctx) => {
    const user = getContextUserOrThrow();
    return ctx.json(
      { data: await updateExportSchedule(ctx.req.param('projectId') ?? '', ctx.req.param('scheduleId'), user.id, ctx.req.valid('json')) },
      200,
    );
  })
  .delete('/schedules/:scheduleId', ...routes.deleteSchedule, async (ctx) => {
    const user = getContextUserOrThrow();
    return ctx.json({ data: await deleteExportSchedule(ctx.req.param('projectId') ?? '', ctx.req.param('scheduleId'), user.id) }, 200);
  })
  .post('/schedules/:scheduleId/run', ...routes.runSchedule, async (ctx) => {
    const user = getContextUserOrThrow();
    return ctx.json({ data: await runExportSchedule(ctx.req.param('projectId') ?? '', ctx.req.param('scheduleId'), user.id) }, 201);
  })
  .post('/:id/cancel', ...routes.cancel, async (ctx) => {
    const user = getContextUserOrThrow();
    return ctx.json({ data: await cancelExport(ctx.req.param('projectId') ?? '', ctx.req.param('id'), user.id) }, 200);
  })
  .get('/:id/artifacts/:artifactId/download', ...routes.download, async (ctx) => {
    const user = getContextUserOrThrow();
    return ctx.json(
      { data: await getExportDownload(ctx.req.param('projectId') ?? '', ctx.req.param('id'), ctx.req.param('artifactId'), user.id) },
      200,
    );
  })
  .get('/:id/artifacts/:artifactId/file', ...routes.file, async (ctx) => {
    const user = getContextUserOrThrow();
    const projectId = ctx.req.param('projectId') ?? '';
    const jobId = ctx.req.param('id');
    const artifactId = ctx.req.param('artifactId');
    const artifact = await getExportDownloadArtifact(projectId, jobId, artifactId);
    const headers = exportFileResponseHeaders(artifact.fileName, artifact.format, artifact.size);
    const signal = ctx.req.raw.signal;
    signal.throwIfAborted();
    const stream = await getObjectStream(artifact.storageKey, undefined, signal);
    const abort = () => stream.destroy();
    signal.addEventListener('abort', abort, { once: true });
    stream.once('close', () => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
    for (const [name, value] of Object.entries(headers)) ctx.header(name, value);
    logPlatformEvent('export_file_requested', { userId: user.id, projectId, metadata: { jobId, artifactId, format: artifact.format } });
    return ctx.body(Readable.toWeb(stream) as ReadableStream);
  })
  .get('/:id', ...routes.get, async (ctx) => ctx.json({ data: await getExport(ctx.req.param('projectId') ?? '', ctx.req.param('id')) }, 200));

export default app;
