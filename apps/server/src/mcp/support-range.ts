import { z } from 'zod';

const days = { '24h': 1, '7d': 7, '30d': 30, '90d': 90 };
export const supportRangeSchema = z
  .object({
    range: z.enum(['24h', '7d', '30d', '90d']).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    timezone: z
      .string()
      .min(1)
      .max(64)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value }).format();
          return true;
        } catch {
          return false;
        }
      }, 'Invalid timezone')
      .optional(),
    language: z.string().trim().min(1).max(35).optional(),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (input.from !== undefined || input.to !== undefined) {
      if (!input.from || !input.to || input.range !== undefined) {
        ctx.addIssue({ code: 'custom', message: 'Use range OR both from and to.' });
      } else {
        const span = Date.parse(input.to) - Date.parse(input.from);
        if (span < 0 || span > 90 * 86_400_000) ctx.addIssue({ code: 'custom', message: 'Date span must be between 0 and 90 days.' });
      }
    }
  });
export type SupportRange = z.infer<typeof supportRangeSchema>;
export const resolveSupportRange = (input: SupportRange) => {
  const to = input.to ? new Date(input.to) : new Date();
  return {
    from: input.from ? new Date(input.from) : new Date(to.getTime() - days[input.range ?? '30d'] * 86_400_000),
    to,
    timezone: input.timezone ?? 'UTC',
    language: input.language,
  };
};
