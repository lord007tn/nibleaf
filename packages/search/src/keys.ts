import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const keys = () =>
  createEnv({
    server: {
      // Maximum Levenshtein typo tolerance for fuzzy matching. Short query
      // tokens use a lower adaptive value so common API acronyms stay precise.
      SEARCH_FUZZY_TOLERANCE: z.coerce.number().min(0).max(3).default(2),
      /** legacy returns Orama, shadow returns Orama while evaluating Qdrant,
       * hybrid makes Qdrant authoritative. Cutover is always reversible. */
      SEARCH_RUNTIME: z.enum(['legacy', 'shadow', 'hybrid']).default('shadow'),
      SEARCH_EMBEDDING_BASE_URL: z.url().default('https://api.openai.com/v1'),
      SEARCH_EMBEDDING_API_KEY: z.string().optional(),
      SEARCH_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
      SEARCH_EMBEDDING_DIMENSIONS: z.coerce.number().int().min(64).max(8192).default(1536),
      SEARCH_EMBEDDING_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(20_000),
      SEARCH_CANDIDATE_LIMIT: z.coerce.number().int().min(10).max(200).default(48),
      SEARCH_CACHE_TTL_MS: z.coerce.number().int().min(0).max(3_600_000).default(60_000),
      SEARCH_ANSWER_ENABLED: z.stringbool().default(false),
      SEARCH_ANSWER_BASE_URL: z.url().default('https://openrouter.ai/api/v1'),
      SEARCH_ANSWER_API_KEY: z.string().optional(),
      SEARCH_ANSWER_MODEL: z.string().default('openai/gpt-5.6-luna'),
      SEARCH_ANSWER_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
      SEARCH_ANSWER_DAILY_PER_PROJECT: z.coerce.number().int().min(0).max(100_000).default(200),
      SEARCH_ANSWER_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(1_000).default(10),
      SEARCH_ANSWER_MIN_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.2),
    },
    runtimeEnv: process.env,
    emptyStringAsUndefined: true,
  });
