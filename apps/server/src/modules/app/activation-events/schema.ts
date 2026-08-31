import { z } from 'zod';

export const firstPublishActivationBody = z
  .object({
    stage: z.enum(['project_entered', 'editor_entered', 'publish_ready']),
    properties: z
      .object({
        entry_point: z.literal('organic_content'),
        intent: z.literal('first_publish'),
        source: z.enum(['docker_compose_guide', 'mintlify_introduction']),
      })
      .strict(),
  })
  .strict();
