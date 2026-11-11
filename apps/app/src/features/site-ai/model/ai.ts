/**
 * Site settings → AI answers, as pure logic (operations/ux/ai-and-integrations.md
 * §4.3, §4.6, §5.1): what the page says about AI answers, which sources it
 * offers, whether the one switch can change, and the "Is it working?"
 * checklist. It takes the server's capabilities and status as plain values;
 * components only render what it returns. Reasons and problems are codes, so
 * the page owns their words.
 *
 * Everything comes from runtime capabilities: nothing here knows whether the
 * server is Nibleaf Cloud or self-hosted.
 */
import type { SiteAiCapabilities, SiteAiStatus } from '@nibleaf/validators';
import type { SiteAdminState } from '@/lib/project-settings-access';

export type AiSource = 'managed' | 'openai' | 'openrouter';
type AiKeyProvider = Exclude<AiSource, 'managed'>;

/** The server's answer for one site: what it can offer, where the site stands, and what this person may change. */
export type SiteAi = { capabilities: SiteAiCapabilities; status: SiteAiStatus; viewer: { canManage: boolean } };

/** The page's access, from what the server says this person may change. Unknown until loaded. */
export const aiAccess = (ai: SiteAi | undefined): SiteAdminState => (!ai ? 'pending' : ai.viewer.canManage ? 'admin' : 'notAdmin');

/** Why a control can't be used. */
type AiBlockReason = 'serverUnavailable' | 'publishFirst' | 'addKeyFirst' | 'keyNotWorking';
export type Decision = { kind: 'allowed' } | { kind: 'locked' } | { kind: 'denied'; reason: AiBlockReason };

/** The one thing stopping answers, when they are on but readers get none. */
type AiProblem =
  | 'keyMissing'
  | 'keyRejected'
  | 'keyUnreachable'
  | 'modelWithdrawn'
  | 'keyNeedsRecheck'
  | 'keyUnreadable'
  | 'managedUnavailable'
  | 'notPublished'
  | 'notPrepared'
  | 'preparationFailed'
  | 'limitReached';

export type AiPageState =
  /** The server can't serve answers to any site: the page shows FeatureUnavailable. */
  | { kind: 'unavailable' }
  | { kind: 'off' }
  /** On; the docs are still being prepared, answers start by themselves (D10). */
  | { kind: 'preparing' }
  | { kind: 'on' }
  | { kind: 'notWorking'; problem: AiProblem };

const allowed: Decision = { kind: 'allowed' };
const locked: Decision = { kind: 'locked' };
const denied = (reason: AiBlockReason): Decision => ({ kind: 'denied', reason });

const providerAvailable = (ai: SiteAi, id: AiKeyProvider) => ai.capabilities.providers.some((provider) => provider.id === id && provider.available);
const connectionOf = (ai: SiteAi, id: AiKeyProvider) => ai.status.connections.find((connection) => connection.id === id);

/** Sources this server can offer at all, in the order the page lists them. */
export function offeredSources(ai: SiteAi): AiSource[] {
  const sources: AiSource[] = [];
  if (ai.capabilities.managed.available) sources.push('managed');
  for (const id of ['openai', 'openrouter'] as const) if (providerAvailable(ai, id)) sources.push(id);
  return sources;
}

/** Whether answers have reached today's limit (a limit of 0 means none are allowed). */
const limitReached = ({ status: { usage } }: SiteAi) => usage.limit === 0 || (usage.answersToday !== null && usage.answersToday >= usage.limit);

/** What stops the selected source from answering, if anything. */
function sourceProblem(ai: SiteAi): AiProblem | null {
  const { source } = ai.status;
  if (source === 'managed') return ai.capabilities.managed.available ? null : 'managedUnavailable';
  if (source === null) return null;
  const connection = connectionOf(ai, source);
  if (!connection) return 'keyMissing';
  if (connection.state === 'rejected') return 'keyRejected';
  if (connection.state === 'unreachable') return 'keyUnreachable';
  if (connection.state === 'modelWithdrawn') return 'modelWithdrawn';
  if (connection.state === 'needsRecheck') return 'keyNeedsRecheck';
  if (connection.state === 'unreadable') return 'keyUnreadable';
  return null;
}

/**
 * The page's headline state. With answers on, the first problem in reader
 * order wins: the source, then publishing, then preparation, then today's limit.
 */
export function aiPageState(ai: SiteAi): AiPageState {
  if (!ai.capabilities.answers.available || offeredSources(ai).length === 0) return { kind: 'unavailable' };
  if (!ai.status.answersOn) return { kind: 'off' };
  const problem: AiProblem | null =
    sourceProblem(ai) ??
    (!ai.status.published
      ? 'notPublished'
      : ai.status.preparation.state === 'failed'
        ? 'preparationFailed'
        : ai.status.preparation.state === 'none'
          ? 'notPrepared'
          : limitReached(ai)
            ? 'limitReached'
            : null);
  if (problem) return { kind: 'notWorking', problem };
  return ai.status.preparation.state === 'running' ? { kind: 'preparing' } : { kind: 'on' };
}

export type SourceOption = {
  id: AiSource;
  selected: boolean;
  /** The site's stored key for this provider, if any (hint and model only). */
  connection: SiteAiStatus['connections'][number] | null;
  /** Choosing this source. */
  decision: Decision;
};

/** The "What powers AI answers" options: only what this server can offer, each with whether it can be chosen. */
export function sourceOptions(ai: SiteAi, access: SiteAdminState): SourceOption[] {
  return offeredSources(ai).map((id) => {
    const connection = id === 'managed' ? null : (connectionOf(ai, id) ?? null);
    const decision =
      access !== 'admin' ? locked : id === 'managed' || connection?.state === 'ok' ? allowed : denied(connection ? 'keyNotWorking' : 'addKeyFirst');
    return { id, selected: ai.status.source === id, connection, decision };
  });
}

/**
 * The one AI answers switch. Turning off is always possible for an admin.
 * Turning on needs a server that can answer, published docs, and a source that
 * works: the selected one, else Nibleaf AI, else a working key of the site's own.
 * `turnsOnWith` is the source the switch would use.
 */
export function switchDecision(ai: SiteAi, access: SiteAdminState): { decision: Decision; turnsOnWith: AiSource | null } {
  if (access !== 'admin') return { decision: locked, turnsOnWith: null };
  if (ai.status.answersOn) return { decision: allowed, turnsOnWith: null };
  if (aiPageState(ai).kind === 'unavailable') return { decision: denied('serverUnavailable'), turnsOnWith: null };
  if (!ai.status.published) return { decision: denied('publishFirst'), turnsOnWith: null };
  const usable = sourceOptions(ai, access).filter((option) => option.decision.kind === 'allowed');
  const choice = usable.find((option) => option.selected) ?? usable.find((option) => option.id === 'managed') ?? usable[0];
  return choice ? { decision: allowed, turnsOnWith: choice.id } : { decision: denied('addKeyFirst'), turnsOnWith: null };
}

/** `warning`: answers work, but something needs a look (some pages couldn't be prepared). */
type ChecklistTone = 'ok' | 'working' | 'warning' | 'problem' | 'idle';
type ChecklistFix = 'publish' | 'prepare' | 'replaceKey' | 'checkKey' | 'checkAgain' | 'changeModel' | 'addKey' | 'seeUsage';
export type ChecklistRow = { id: 'published' | 'prepared' | 'source' | 'usage'; tone: ChecklistTone; fix: ChecklistFix | null };

const SOURCE_FIX: Partial<Record<AiProblem, ChecklistFix>> = {
  keyMissing: 'addKey',
  keyRejected: 'replaceKey',
  keyUnreachable: 'checkAgain',
  modelWithdrawn: 'changeModel',
  keyUnreadable: 'replaceKey',
  keyNeedsRecheck: 'checkKey',
};

/** "Is it working?": each step answers need, with the one fix for a failing step. */
export function checklist(ai: SiteAi): ChecklistRow[] {
  const { status } = ai;
  const published: ChecklistRow = { id: 'published', tone: status.published ? 'ok' : 'problem', fix: status.published ? null : 'publish' };
  const preparation = status.preparation.state;
  const prepared: ChecklistRow = !status.published
    ? { id: 'prepared', tone: 'idle', fix: null }
    : preparation === 'ready'
      ? { id: 'prepared', tone: 'ok', fix: null }
      : preparation === 'partial'
        ? { id: 'prepared', tone: 'warning', fix: 'prepare' }
        : preparation === 'running'
          ? { id: 'prepared', tone: 'working', fix: null }
          : { id: 'prepared', tone: 'problem', fix: 'prepare' };
  const problem = sourceProblem(ai);
  const source: ChecklistRow =
    status.source === null
      ? { id: 'source', tone: 'idle', fix: null }
      : problem
        ? { id: 'source', tone: 'problem', fix: SOURCE_FIX[problem] ?? null }
        : { id: 'source', tone: status.answersOn ? 'ok' : 'idle', fix: null };
  const usage: ChecklistRow = limitReached(ai)
    ? { id: 'usage', tone: 'problem', fix: 'seeUsage' }
    : { id: 'usage', tone: status.usage.answersToday === null ? 'idle' : 'ok', fix: null };
  return [published, prepared, source, usage];
}
