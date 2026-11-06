import { largestChatTurnTokens } from '@nibleaf/search';
import { AI_CHAT_LIMITS } from '@nibleaf/validators';
import { envExtras } from '@/lib/env-extras';
import { aiSpendRedis } from './quota';

type ChatBudgetLimits = Pick<
  typeof envExtras,
  'SEARCH_CHAT_HISTORY_MESSAGES' | 'SEARCH_CHAT_HISTORY_MAX_TOKENS' | 'SEARCH_CHAT_MAX_CONVERSATION_TOKENS' | 'SEARCH_CHAT_DAILY_TOKENS_PER_PROJECT'
>;

/** Token budgets below the largest reservation a turn makes before it runs (the
 * longest question with a full history) refuse every such turn. Reported at
 * startup so an operator can raise them; null when both budgets fit it. */
export const chatBudgetWarning = (limits: ChatBudgetLimits = envExtras) => {
  const largestTurnTokens = largestChatTurnTokens({
    questionMax: AI_CHAT_LIMITS.questionMax,
    historyLimits: { maxMessages: limits.SEARCH_CHAT_HISTORY_MESSAGES, maxTokens: limits.SEARCH_CHAT_HISTORY_MAX_TOKENS },
  });
  const daily = limits.SEARCH_CHAT_DAILY_TOKENS_PER_PROJECT;
  const settings = [
    ...(limits.SEARCH_CHAT_MAX_CONVERSATION_TOKENS < largestTurnTokens ? ['SEARCH_CHAT_MAX_CONVERSATION_TOKENS'] : []),
    ...(daily > 0 && daily < largestTurnTokens ? ['SEARCH_CHAT_DAILY_TOKENS_PER_PROJECT'] : []),
  ];
  return settings.length ? { settings, largestTurnTokens } : null;
};

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

// Admit a turn only if its reserved tokens, plus the headroom it may still
// reserve (ARGV[7]), fit under each cap, so no turn can start that might take
// spend past it or have to read less than it found. Check every cap before counting the turn,
// so a refused request never consumes capacity, then count the turn and reserve
// its estimated tokens in the same atomic step: concurrent turns each see the
// others' reservations. Returns [allowed, turnsUsed, refusal]; refusal 1 is the
// conversation cap, 2 the project's daily token budget.
const RESERVE = `
local turns = tonumber(redis.call('HGET', KEYS[1], 'turns') or '0')
local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens') or '0')
local daily = tonumber(redis.call('GET', KEYS[2]) or '0')
local reserve = tonumber(ARGV[5])
local room = reserve + tonumber(ARGV[7])
if turns >= tonumber(ARGV[1]) or tokens + room > tonumber(ARGV[2]) then return {0, turns, 1} end
if tonumber(ARGV[3]) > 0 and daily + room > tonumber(ARGV[3]) then return {0, turns, 2} end
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

// Reserve up to ARGV[1] more tokens for a turn already admitted: as many as both
// caps still have room for, possibly none, in one atomic step so concurrent turns
// never pass a cap together. Returns the tokens granted.
const EXTEND = `
local tokens = tonumber(redis.call('HGET', KEYS[1], 'tokens') or '0')
local grant = math.min(tonumber(ARGV[1]), tonumber(ARGV[2]) - tokens)
if tonumber(ARGV[3]) > 0 then
  local daily = tonumber(redis.call('GET', KEYS[2]) or '0')
  grant = math.min(grant, tonumber(ARGV[3]) - daily)
end
if grant <= 0 then return 0 end
redis.call('HINCRBY', KEYS[1], 'tokens', grant)
redis.call('EXPIRE', KEYS[1], ARGV[4])
redis.call('INCRBY', KEYS[2], grant)
redis.call('EXPIRE', KEYS[2], ARGV[5])
return grant`;

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
 * spend, admitting it only while each budget also has `headroomTokens` more room
 * (what the turn may still reserve once it knows what it reads). Throws when
 * Redis is unavailable: callers fail closed, like the daily answer quota. */
export const reserveChatTurn = async (
  projectId: string,
  conversationId: string,
  estimatedTokens: number,
  now = new Date(),
  headroomTokens = 0,
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
    whole(headroomTokens),
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

/** Reserve more for an admitted turn once it knows what it will read: up to
 * `wantedTokens`, as many as the conversation and daily budgets still have room
 * for (possibly none). The hold grows by what is granted, so settling replaces
 * the whole reservation. */
export const extendChatTurn = async (projectId: string, conversationId: string, hold: ChatTurnHold, wantedTokens: number): Promise<number> => {
  const wanted = whole(wantedTokens);
  if (wanted === 0) return 0;
  const keys = keysFor(projectId, conversationId, hold.reservedAt);
  const client = await aiSpendRedis();
  const granted = Math.max(
    0,
    Number(
      await client.eval(
        EXTEND,
        2,
        keys.conversation,
        keys.dailyTokens,
        wanted,
        envExtras.SEARCH_CHAT_MAX_CONVERSATION_TOKENS,
        envExtras.SEARCH_CHAT_DAILY_TOKENS_PER_PROJECT,
        CONVERSATION_TTL_SECONDS,
        DAY_TTL_SECONDS,
      ),
    ),
  );
  hold.reservedTokens += granted;
  return granted;
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
