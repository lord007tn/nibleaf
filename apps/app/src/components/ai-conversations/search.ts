import { z } from 'zod';
export const aiDashboardSearch = z.object({
  tab: z.enum(['overview', 'conversations', 'gaps']).catch('overview'),
  range: z.enum(['7d', '30d', '90d']).catch('30d'),
  language: z.string().trim().min(2).max(35).optional().catch(undefined),
  rating: z.enum(['up', 'down', 'unrated']).optional().catch(undefined),
  status: z.enum(['answered', 'no_answer', 'failed']).optional().catch(undefined),
  q: z.string().trim().min(1).max(120).optional().catch(undefined),
  conversation: z.string().min(1).max(256).optional().catch(undefined),
});
export type AiDashboardSearch = z.infer<typeof aiDashboardSearch>;
