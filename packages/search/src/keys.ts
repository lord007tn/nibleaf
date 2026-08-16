import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const keys = () =>
  createEnv({
    server: {
      // Maximum Levenshtein typo tolerance for fuzzy matching. Short query
      // tokens use a lower adaptive value so common API acronyms stay precise.
      SEARCH_FUZZY_TOLERANCE: z.coerce.number().min(0).max(3).default(2),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
  });
