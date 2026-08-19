import { z } from 'zod';

const common = {
  product: z.literal('nibleaf'),
  tool_slug: z.literal('rtl-documentation-readiness'),
};

export const marketingEventBody = z.discriminatedUnion('event', [
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

export type MarketingEventBody = z.infer<typeof marketingEventBody>;
