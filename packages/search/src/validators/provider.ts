import { z } from 'zod';

export const embeddingResponseSchema = z.object({
  data: z.array(z.object({ embedding: z.array(z.number()), index: z.number().optional() })),
  model: z.string(),
  usage: z.object({ promptTokens: z.number(), totalTokens: z.number() }).optional(),
});

export const answerOutputSchema = z
  .object({
    status: z.enum(['answered', 'no_answer']),
    answer: z.string(),
    confidence: z.number().min(0).max(1),
    citations: z.array(z.string()),
  })
  .strict();

export const nonEmptyProviderTextSchema = z.string().trim().min(1);
