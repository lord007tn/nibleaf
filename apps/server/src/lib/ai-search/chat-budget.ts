import { envExtras } from '@/lib/env-extras';
import { aiSpendRedis } from './quota';

/** Conversation counters outlive any realistic reading session; daily token
 * keys cover the UTC day plus a margin for late reconciliation. */
const CONVERSATION_TTL_SECONDS = 24 * 60 * 60;
const DAY_TTL_SECONDS = 2 * 24 * 60 * 60;

const day = (now: Date): string => now.toISOString().slice(0, 10);

/** One hash tag per project keeps both keys of a script in the same Dragonfly
 * lock/slot without serializing every tenant behind a global tag. */
const keysFor = (projectId: string, conversationId: string, now: Date) => {
  const tag = `{search-chat:${projectId}}`;
  return { conversation: `${tag}:conversation:${conversationId}`, dailyTokens: `${tag}:tokens:${day(now)}` };
};

// Check every cap before counting the turn so a refused request never consumes
// conversation capacity. Returns [allowed, turnsUsed, refusal]; refusal 1 is the
// conversation cap, 2 the project's daily token budget.
const RESERVE = `
local turns = tonumber(redis.call('HGET', KEYS[1], 'turns') or '0')
local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens') or '0')
local daily = tonumber(redis.call('GET', KEYS[2]) or '0')
if turns >= tonumber(ARGV[1]) or tokens >= tonumber(ARGV[2]) then return {0, turns, 1} end
if tonumber(ARGV[3]) > 0 and daily >= tonumber(ARGV[3]) then return {0, turns, 2} end
turns = redis.call('HINCRBY', KEYS[1], 'turns', 1)
redis.call('EXPIRE', KEYS[1], ARGV[4])
return {1, turns, 0}`;

const RELEASE = `
local turns = tonumber(redis.call('HGET', KEYS[1], 'turns') or '0')
if turns > 0 then redis.call('HINCRBY', KEYS[1], 'turns', -1) end
return 1`;

const SPEND = `
redis.call('HINCRBY', KEYS[1], 'tokens', ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[2])
redis.call('INCRBY', KEYS[2], ARGV[1])
redis.call('EXPIRE', KEYS[2], ARGV[3])
return 1`;

export type ChatTurnReservation =
  | { allowed: true; turnIndex: number; turnsRemaining: number }
  | { allowed: false; reason: 'conversation_limit' | 'budget_exhausted' };

/** Reserve one conversation turn before any provider spend. Throws when Redis is
 * unavailable: callers fail closed, like the daily answer quota. */
export const reserveChatTurn = async (projectId: string, conversationId: string, now = new Date()): Promise<ChatTurnReservation> => {
  const keys = keysFor(projectId, conversationId, now);
  const client = await aiSpendRedis();
  const result = (await client.eval(
    RESERVE,
    2,
    keys.conversation,
    keys.dailyTokens,
    envExtras.SEARCH_CHAT_MAX_TURNS,
    envExtras.SEARCH_CHAT_MAX_CONVERSATION_TOKENS,
    envExtras.SEARCH_CHAT_DAILY_TOKENS_PER_PROJECT,
    CONVERSATION_TTL_SECONDS,
  )) as [number, number, number];
  const [allowed, turns, refusal] = result.map(Number) as [number, number, number];
  if (allowed !== 1) return { allowed: false, reason: refusal === 2 ? 'budget_exhausted' : 'conversation_limit' };
  return { allowed: true, turnIndex: turns - 1, turnsRemaining: Math.max(0, envExtras.SEARCH_CHAT_MAX_TURNS - turns) };
};

/** Undo a reservation when a later gate (the daily answer quota) refuses the turn. */
export const releaseChatTurn = async (projectId: string, conversationId: string, now = new Date()): Promise<void> => {
  const keys = keysFor(projectId, conversationId, now);
  const client = await aiSpendRedis();
  await client.eval(RELEASE, 1, keys.conversation);
};

/** Count provider tokens against the conversation and the project's day. */
export const recordChatSpend = async (projectId: string, conversationId: string, tokens: number, now = new Date()): Promise<void> => {
  const spent = Math.max(0, Math.ceil(tokens));
  if (spent === 0) return;
  const keys = keysFor(projectId, conversationId, now);
  const client = await aiSpendRedis();
  await client.eval(SPEND, 2, keys.conversation, keys.dailyTokens, spent, CONVERSATION_TTL_SECONDS, DAY_TTL_SECONDS);
};
