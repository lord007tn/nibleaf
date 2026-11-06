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

// Check every cap before counting the turn, so a refused request never consumes
// capacity, then count the turn and reserve its estimated tokens in the same
// atomic step: concurrent turns each see the others' reservations, so they can't
// all pass against the same total. Returns [allowed, turnsUsed, refusal];
// refusal 1 is the conversation cap, 2 the project's daily token budget.
const RESERVE = `
local turns = tonumber(redis.call('HGET', KEYS[1], 'turns') or '0')
local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens') or '0')
local daily = tonumber(redis.call('GET', KEYS[2]) or '0')
if turns >= tonumber(ARGV[1]) or tokens >= tonumber(ARGV[2]) then return {0, turns, 1} end
if tonumber(ARGV[3]) > 0 and daily >= tonumber(ARGV[3]) then return {0, turns, 2} end
turns = redis.call('HINCRBY', KEYS[1], 'turns', 1)
redis.call('HINCRBY', KEYS[1], 'tokens', ARGV[5])
redis.call('EXPIRE', KEYS[1], ARGV[4])
redis.call('INCRBY', KEYS[2], ARGV[5])
redis.call('EXPIRE', KEYS[2], ARGV[6])
return {1, turns, 0}`;

// Move both token counters by ARGV[1] (negative to give tokens back), never below zero.
const ADJUST = `
local tokens = redis.call('HINCRBY', KEYS[1], 'tokens', ARGV[1])
if tokens < 0 then redis.call('HINCRBY', KEYS[1], 'tokens', -tokens) end
redis.call('EXPIRE', KEYS[1], ARGV[2])
local daily = redis.call('INCRBY', KEYS[2], ARGV[1])
if daily < 0 then redis.call('INCRBY', KEYS[2], -daily) end
redis.call('EXPIRE', KEYS[2], ARGV[3])
return 1`;

// Undo a turn and its reservation.
const RELEASE = `
local turns = tonumber(redis.call('HGET', KEYS[1], 'turns') or '0')
if turns > 0 then redis.call('HINCRBY', KEYS[1], 'turns', -1) end
${ADJUST}`;

/** A reserved turn: settle it with its actual usage when it ends. */
export interface ChatTurnHold {
  reservedTokens: number;
  /** When the reservation was made, so settling hits the same day's counter. */
  reservedAt: Date;
}

export type ChatTurnReservation =
  | ({ allowed: true; turnIndex: number; turnsRemaining: number } & ChatTurnHold)
  | { allowed: false; reason: 'conversation_limit' | 'budget_exhausted' };

const whole = (tokens: number) => Math.max(0, Math.ceil(tokens));

/** Reserve one conversation turn and its estimated tokens before any provider
 * spend. Throws when Redis is unavailable: callers fail closed, like the daily
 * answer quota. */
export const reserveChatTurn = async (
  projectId: string,
  conversationId: string,
  estimatedTokens: number,
  now = new Date(),
): Promise<ChatTurnReservation> => {
  const keys = keysFor(projectId, conversationId, now);
  const reservedTokens = whole(estimatedTokens);
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
    reservedTokens,
    DAY_TTL_SECONDS,
  )) as [number, number, number];
  const [allowed, turns, refusal] = result.map(Number) as [number, number, number];
  if (allowed !== 1) return { allowed: false, reason: refusal === 2 ? 'budget_exhausted' : 'conversation_limit' };
  return {
    allowed: true,
    turnIndex: turns - 1,
    turnsRemaining: Math.max(0, envExtras.SEARCH_CHAT_MAX_TURNS - turns),
    reservedTokens,
    reservedAt: now,
  };
};

/** Undo a reservation when a later gate (the daily answer quota) refuses the turn. */
export const releaseChatTurn = async (projectId: string, conversationId: string, hold: ChatTurnHold): Promise<void> => {
  const keys = keysFor(projectId, conversationId, hold.reservedAt);
  const client = await aiSpendRedis();
  await client.eval(RELEASE, 2, keys.conversation, keys.dailyTokens, -hold.reservedTokens, CONVERSATION_TTL_SECONDS, DAY_TTL_SECONDS);
};

/** Replace a turn's reservation with what it actually spent (more or less). */
export const settleChatSpend = async (projectId: string, conversationId: string, hold: ChatTurnHold, spentTokens: number): Promise<void> => {
  const delta = whole(spentTokens) - hold.reservedTokens;
  if (delta === 0) return;
  const keys = keysFor(projectId, conversationId, hold.reservedAt);
  const client = await aiSpendRedis();
  await client.eval(ADJUST, 2, keys.conversation, keys.dailyTokens, delta, CONVERSATION_TTL_SECONDS, DAY_TTL_SECONDS);
};
