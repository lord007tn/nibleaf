import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const keys = () =>
  createEnv({
    server: {
      // Levenshtein typo tolerance for fuzzy matching (0 disables fuzzy).
      SEARCH_FUZZY_TOLERANCE: z.coerce.number().min(0).max(3).default(1),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
  });
