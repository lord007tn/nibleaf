import { z } from 'zod';

export const importDocumentSchema = z.record(z.string(), z.unknown());
export const nonEmptyImportStringSchema = z.string().trim().min(1);
export const ghostMobiledocSchema = z.object({ version: z.string() }).loose();
