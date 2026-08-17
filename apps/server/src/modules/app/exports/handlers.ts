import { createExportBody, createExportScheduleBody, updateExportScheduleBody } from '@nibleaf/validators';
import { Hono } from 'hono';
import {
  cancelExport,
  createExport,
  createExportSchedule,
  deleteExportSchedule,
  getExport,
  getExportDownload,
  listExportSchedules,
  listExports,
  runExportSchedule,
  updateExportSchedule,
} from '@/actions/exports';
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
  .get('/:id', ...routes.get, async (ctx) => ctx.json({ data: await getExport(ctx.req.param('projectId') ?? '', ctx.req.param('id')) }, 200));

export default app;
