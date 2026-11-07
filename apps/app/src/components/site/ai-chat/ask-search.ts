import { z } from 'zod';

/** The reader layout's `?ask=` deep link. It lives apart from the panel's
 * helpers, so the eager route doesn't pull them into the public docs bundle. */
export const askSearchSchema = z.string().trim().min(2).max(500).optional().catch(undefined);
