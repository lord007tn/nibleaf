import { addonConfigSchemas, parseAddonConfig, addonIdSchema as sharedAddonIdSchema } from '@nibleaf/shared/addons';
import { z } from 'zod';

export { addonConfigSchemas, parseAddonConfig };

export const addonIdSchema = sharedAddonIdSchema;
export const addonIdParam = z.object({ addonId: addonIdSchema, projectId: z.string().min(1) }).strict();

export const updateProjectAddonBody = z
  .object({
    config: z.record(z.string(), z.unknown()),
    expectedRevision: z.number().int().min(0),
  })
  .strict();
export type UpdateProjectAddonBody = z.infer<typeof updateProjectAddonBody>;

export const mutateProjectAddonBody = z.object({ expectedRevision: z.number().int().min(0) }).strict();
export type MutateProjectAddonBody = z.infer<typeof mutateProjectAddonBody>;

export const listProjectAddonAuditQuery = z
  .object({
    addonId: addonIdSchema.optional(),
    cursor: z.string().min(1).max(64).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
export type ListProjectAddonAuditQuery = z.infer<typeof listProjectAddonAuditQuery>;
