import { z } from 'zod';

export const firstPublishAttribution = z
  .object({
    entry_point: z.enum(['organic_content', 'free_tool']),
    intent: z.literal('first_publish'),
    source: z.enum(['docker_compose_guide', 'mintlify_introduction', 'rtl_readiness_grader']),
  })
  .strict()
  .refine((p) => p.entry_point === (p.source === 'rtl_readiness_grader' ? 'free_tool' : 'organic_content'));

export const firstPublishActivationBody = z
  .object({
    stage: z.enum(['project_entered', 'editor_entered']),
    properties: firstPublishAttribution,
  })
  .strict();
