import { EXPORT_CREATE_ROLE, EXPORT_SCHEDULE_ROLE } from '@nibleaf/shared/rbac';
import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';
import { isAuthenticated, requireProjectMember, requireProjectRole } from '@/middlewares/guard';

const member = [isAuthenticated, requireProjectMember()] as const;
const editor = [isAuthenticated, requireProjectRole(EXPORT_CREATE_ROLE)] as const;
const admin = [isAuthenticated, requireProjectRole(EXPORT_SCHEDULE_ROLE)] as const;
const ok = { 200: { description: 'ok' }, ...errorResponses };

export default {
  list: createRouteConfig({ guard: [...member], tags: ['exports'], description: 'List export run history.', responses: ok }),
  get: createRouteConfig({ guard: [...member], tags: ['exports'], description: 'Inspect one export run.', responses: ok }),
  create: createRouteConfig({
    guard: [...editor],
    tags: ['exports'],
    description: 'Queue export formats from one published snapshot.',
    responses: { 201: { description: 'queued' }, ...errorResponses },
  }),
  cancel: createRouteConfig({ guard: [...editor], tags: ['exports'], description: 'Cancel a queued or running export.', responses: ok }),
  download: createRouteConfig({
    guard: [...member],
    tags: ['exports'],
    description: 'Create a short-lived private artifact download URL.',
    responses: ok,
  }),
  schedules: createRouteConfig({ guard: [...member], tags: ['exports'], description: 'List archive schedules and run counts.', responses: ok }),
  createSchedule: createRouteConfig({
    guard: [...admin],
    tags: ['exports'],
    description: 'Create an archival export schedule.',
    responses: { 201: { description: 'created' }, ...errorResponses },
  }),
  updateSchedule: createRouteConfig({
    guard: [...admin],
    tags: ['exports'],
    description: 'Update, enable, or disable an archive schedule.',
    responses: ok,
  }),
  deleteSchedule: createRouteConfig({
    guard: [...admin],
    tags: ['exports'],
    description: 'Delete an archive schedule without deleting retained runs.',
    responses: ok,
  }),
  runSchedule: createRouteConfig({
    guard: [...admin],
    tags: ['exports'],
    description: 'Run an archive schedule immediately.',
    responses: { 201: { description: 'queued' }, ...errorResponses },
  }),
};
