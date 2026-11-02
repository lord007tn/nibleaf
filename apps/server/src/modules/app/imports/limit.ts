import { createMiddleware } from 'hono/factory';
import { AppError } from '@/errors';
import type { HonoEnv } from '@/lib/hono/context';

const projects = new Set<string>();
let gitbookImports = 0;

export const limitImport = (source: 'gitbook' | 'mintlify' | 'ghost') =>
  createMiddleware<HonoEnv>(async (ctx, next) => {
    const projectId = ctx.req.param('projectId') ?? '';
    if (projects.has(projectId)) throw new AppError({ code: 'import:in_progress', message: 'An import is already running for this project.' });
    if (source === 'gitbook' && gitbookImports >= 2) {
      ctx.header('Retry-After', '10');
      throw new AppError({ code: 'import:busy', message: 'Import capacity is busy. Try again shortly.' });
    }
    projects.add(projectId);
    if (source === 'gitbook') gitbookImports++;
    try {
      await next();
    } finally {
      projects.delete(projectId);
      if (source === 'gitbook') gitbookImports--;
    }
  });
