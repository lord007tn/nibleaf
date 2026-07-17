import { errorResponses } from '@/errors/utils';
import { createRouteConfig } from '@/lib/hono/route-config';

// Unauthenticated by design: deliveries are authenticated by the per-project
// webhook secret (GitHub HMAC signature / GitLab token), not by a session.
const passthrough = (_: unknown, next: () => Promise<void>) => next();

const gitRoutes = {
  webhook: createRouteConfig({
    guard: passthrough,
    tags: ['public'],
    description:
      'Git push webhook (push-to-deploy). Verifies GitHub X-Hub-Signature-256 or GitLab X-Gitlab-Token, then imports the configured repository — and auto-publishes when enabled — on pushes to the configured branch. Ping and other events are acknowledged and ignored.',
    responses: {
      200: { description: 'acknowledged (ping, non-push event, or other branch)' },
      202: { description: 'push accepted — import (and optional publish) run in the background' },
      ...errorResponses,
    },
  }),
};

export default gitRoutes;
