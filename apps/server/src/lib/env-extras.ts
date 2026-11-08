import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

/**
 * Operational tuning knobs kept in their own createEnv so files under lib/ can
 * consume them without importing the full app env. Same conventions as
 * src/env.ts (validated once at import, empty strings treated as unset).
 */
export const envExtras = createEnv({
  server: {
    /** Per-IP request budget for /api/public/* (requests per minute). */
    RATE_LIMIT_PUBLIC_PER_MIN: z.coerce.number().int().positive().default(300),
    /** Expensive grounded-answer budget per caller, enforced in addition to the
     * shared public limiter. */
    SEARCH_ANSWER_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).max(1000).default(10),
    /** Reader AI chat: prior messages (user + assistant) sent to the model. */
    SEARCH_CHAT_HISTORY_MESSAGES: z.coerce.number().int().min(0).max(12).default(6),
    /** Reader AI chat: estimated token cap for that history. */
    SEARCH_CHAT_HISTORY_MAX_TOKENS: z.coerce.number().int().min(0).max(16_000).default(1500),
    /** Reader AI chat: questions allowed in one conversation before readers are asked to start a new chat. */
    SEARCH_CHAT_MAX_TURNS: z.coerce.number().int().min(1).max(200).default(20),
    /** Reader AI chat: provider tokens one conversation may spend. */
    SEARCH_CHAT_MAX_CONVERSATION_TOKENS: z.coerce.number().int().min(1000).max(10_000_000).default(150_000),
    /** Reader AI chat: cheaper OpenRouter model for follow-up rewriting and suggested
     * questions, used whenever a turn runs on an OpenRouter connection (the
     * instance's or a workspace's) and billed to it. Empty uses the answer model. */
    SEARCH_CHAT_UTILITY_MODEL: z.string().trim().min(1).max(120).optional(),
    /** Reader AI chat: the longest a suggested-questions call may take after the answer. */
    SEARCH_CHAT_SUGGESTIONS_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(15_000),
    /** Reader AI chat: provider tokens one project may spend per UTC day. 0 disables this budget. */
    SEARCH_CHAT_DAILY_TOKENS_PER_PROJECT: z.coerce.number().int().min(0).max(1_000_000_000).default(2_000_000),
    /** Per-workspace daily cap on AI draft calls. 0 disables AI drafting entirely. */
    AI_DAILY_LIMIT: z.coerce.number().int().min(0).default(50),
    /** Instance-level switch to turn off self-serve sign-up (surfaced via /api/public/meta). */
    DISABLE_SIGNUP: z
      .string()
      .optional()
      .transform((value) => value === 'true' || value === '1'),
    /** Optional GTM container ID for the instance's public marketing pages.
     *  It is deliberately public and takes precedence over MARKETING_GA4_ID. */
    MARKETING_GTM_ID: z
      .string()
      .regex(/^GTM-[A-Z0-9]{6,}$/i)
      .refine((value) => !/^GTM-X+$/i.test(value), 'Use the real GTM container ID, not the GTM-XXXXXXX placeholder.')
      .optional()
      .transform((value) => value?.toUpperCase()),
    /** Legacy direct GA4 fallback for self-hosters. GTM is preferred when both
     *  variables are configured. Both providers load only after consent. */
    MARKETING_GA4_ID: z
      .string()
      .regex(/^G-[A-Z0-9]{6,}$/i)
      .refine((value) => !/^G-X+$/i.test(value), 'Use the real GA4 measurement ID, not the G-XXXXXXXXXX placeholder.')
      .optional()
      .transform((value) => value?.toUpperCase()),
    /** Count every address after the client in X-Forwarded-For, private ones included.
     *  Use the same count on app and API. Raising this past
     *  your real proxy depth lets clients spoof their rate-limit identity. */
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(8).default(0),
    /** Shared secret between the app's SSR proxy and this API. When set, the
     *  `x-nibleaf-client-ip` rate-limit hint is only honoured on requests that
     *  also carry a matching `x-nibleaf-internal` header — without it a browser
     *  could spoof the hint through the app's /api proxy into fresh buckets.
     *  Unset (default) the hint is ignored entirely, which is the safe default. */
    INTERNAL_API_SECRET: z.string().optional(),
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});
