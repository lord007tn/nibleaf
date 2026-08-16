import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';

// Unauthenticated by design: deliveries are authenticated by the per-project
// webhook secret (GitHub HMAC signature / GitLab token), not by a session.
const passthrough = (_: unknown, next: () => Promise<void>) => next();

const gitRoutes = {
  job: createRouteConfig({
    guard: passthrough,
    tags: ['internal'],
    description: 'Internal worker callback for an opaque, idempotent Git operation.',
    responses: { 200: { description: 'processed' }, ...errorResponses },
  }),
  preview: createRouteConfig({
    guard: passthrough,
    tags: ['public'],
    description: 'Return an immutable READY pull-request preview snapshot by unguessable token.',
    responses: { 200: { description: 'preview snapshot' }, ...errorResponses },
  }),
  webhook: createRouteConfig({
    guard: passthrough,
    tags: ['public'],
    description:
      'Git provider webhook. Verifies raw-body signatures, deduplicates provider delivery ids, and queues secure branch/PR reconciliation. Legacy one-way GitHub/GitLab webhooks remain supported.',
    responses: {
      200: { description: 'acknowledged (ping, non-push event, or other branch)' },
      202: { description: 'push accepted — import (and optional publish) run in the background' },
      ...errorResponses,
    },
  }),
};

export default gitRoutes;
