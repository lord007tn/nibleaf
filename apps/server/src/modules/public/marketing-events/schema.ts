import { z } from 'zod';

const common = {
  product: z.literal('nibleaf'),
  tool_slug: z.literal('rtl-documentation-readiness'),
};

export const marketingEventBody = z.discriminatedUnion('event', [
  z
    .object({
      event: z.literal('first_publish_landing_viewed'),
      properties: z
        .object({
          entry_point: z.enum(['organic_content', 'free_tool']),
          intent: z.literal('first_publish'),
          source: z.enum(['docker_compose_guide', 'mintlify_introduction', 'rtl_readiness_grader']),
        })
        .strict()
        .refine((p) => p.entry_point === (p.source === 'rtl_readiness_grader' ? 'free_tool' : 'organic_content')),
    })
    .strict(),
  z
    .object({
      event: z.literal('first_publish_cta_clicked'),
      properties: z
        .object({
          destination: z.literal('signup'),
          entry_point: z.enum(['organic_content', 'free_tool']),
          intent: z.literal('first_publish'),
          placement: z.enum(['article_bridge', 'result_bridge']),
          source: z.enum(['docker_compose_guide', 'mintlify_introduction', 'rtl_readiness_grader']),
        })
        .strict()
        .refine(
          (p) =>
            p.entry_point === (p.source === 'rtl_readiness_grader' ? 'free_tool' : 'organic_content') &&
            p.placement === (p.source === 'rtl_readiness_grader' ? 'result_bridge' : 'article_bridge'),
        ),
    })
    .strict(),
  z
    .object({
      event: z.literal('free_tool_started'),
      properties: z
        .object({
          ...common,
          input_mode: z.literal('html'),
          page_path: z.literal('/tools/rtl-documentation-readiness'),
          rubric_version: z.string().regex(/^\d+\.\d+\.\d+$/u),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      event: z.literal('free_tool_completed'),
      properties: z
        .object({
          ...common,
          category_count: z.number().int().min(1).max(20),
          checks_run: z.number().int().min(0).max(100),
          checks_unknown: z.number().int().min(0).max(100),
          result_type: z.enum(['strong_evidence', 'work_remaining', 'material_gaps', 'insufficient_evidence']),
          rubric_version: z.string().regex(/^\d+\.\d+\.\d+$/u),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      event: z.literal('free_tool_cta_clicked'),
      properties: z
        .object({
          ...common,
          destination: z.enum(['sample_project_signup', 'fixture_corpus']),
          placement: z.literal('result_bridge'),
        })
        .strict(),
    })
    .strict(),
]);
