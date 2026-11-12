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
export type AiKeyProvider = Exclude<AiSource, 'managed'>;

/** The server's answer for one site: what it can offer, where the site stands, and what this person may change. */
export type SiteAi = { capabilities: SiteAiCapabilities; status: SiteAiStatus; viewer: { canManage: boolean } };

/** The page's access, from what the server says this person may change. Unknown until loaded. */
export const aiAccess = (ai: SiteAi | undefined): SiteAdminState => (!ai ? 'pending' : ai.viewer.canManage ? 'admin' : 'notAdmin');

/** Why a control can't be used. */
export type AiBlockReason = 'serverUnavailable' | 'publishFirst' | 'addKeyFirst' | 'keyNotWorking';
export type Decision = { kind: 'allowed' } | { kind: 'locked' } | { kind: 'denied'; reason: AiBlockReason };

/** The one thing stopping answers, when they are on but readers get none. */
export type AiProblem =
  | 'keyMissing'
  | 'keyRejected'
  /** The provider account behind the key has no credit left. */
  | 'keyOutOfCredit'
  /** The selected own-key provider isn't offered by this server any more (e.g. after an embedding change). */
  | 'sourceNotOffered'
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
/** A key answers readers while it works, and while its provider only rate-limits it. */
const keyServes = (state: SiteAiStatus['connections'][number]['state'] | undefined) => state === 'ok' || state === 'rateLimited';

/** Sources this server can offer at all, in the order the page lists them. */
export function offeredSources(ai: SiteAi): AiSource[] {
  const sources: AiSource[] = [];
  if (ai.capabilities.managed.available) sources.push('managed');
  for (const id of ['openai', 'openrouter'] as const) if (providerAvailable(ai, id)) sources.push(id);
  return sources;
}

/**
 * Whether readers are refused today: decided by the quota the server spends
 * (failed generations included), not by completed answers. A limit of 0 means
 * none are allowed.
 */
const limitReached = ({ status: { usage } }: SiteAi) => usage.limit === 0 || (usage.spent !== null && usage.spent >= usage.limit);

/** What stops the selected source from answering, if anything. */
function sourceProblem(ai: SiteAi): AiProblem | null {
  const { source } = ai.status;
  if (source === 'managed') return ai.capabilities.managed.available ? null : 'managedUnavailable';
  if (source === null) return null;
  // Whatever state its key is in, a provider the server no longer offers can't be checked again: choose another source.
  if (!providerAvailable(ai, source)) return 'sourceNotOffered';
  const connection = connectionOf(ai, source);
  if (!connection) return 'keyMissing';
  if (connection.state === 'rejected') return 'keyRejected';
  if (connection.state === 'outOfCredit') return 'keyOutOfCredit';
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
      access !== 'admin' ? locked : id === 'managed' || keyServes(connection?.state) ? allowed : denied(connection ? 'keyNotWorking' : 'addKeyFirst');
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
export type ChecklistFix = 'publish' | 'prepare' | 'replaceKey' | 'checkKey' | 'checkAgain' | 'changeModel' | 'chooseSource' | 'addKey' | 'seeUsage';
export type ChecklistRow = {
  id: 'published' | 'prepared' | 'source' | 'usage';
  tone: ChecklistTone;
  fix: ChecklistFix | null;
  /** The source row's problem, whether or not answers are on: a broken key never reads as working. */
  problem?: AiProblem;
};

const SOURCE_FIX: Partial<Record<AiProblem, ChecklistFix>> = {
  keyMissing: 'addKey',
  keyRejected: 'replaceKey',
  keyOutOfCredit: 'checkAgain',
  sourceNotOffered: 'chooseSource',
  keyUnreachable: 'checkAgain',
  modelWithdrawn: 'changeModel',
  keyUnreadable: 'replaceKey',
  keyNeedsRecheck: 'checkKey',
};

/**
 * The source "Is it working?" reports on. With answers off, a saved source this
 * server doesn't offer (e.g. Nibleaf AI on a server without an AI key) counts as
 * no choice yet: nothing is broken until readers depend on it.
 */
export function checklistSource(ai: SiteAi): AiSource | null {
  const problem = sourceProblem(ai);
  if (!ai.status.answersOn && (problem === 'managedUnavailable' || problem === 'sourceNotOffered')) return null;
  return ai.status.source;
}

/**
 * Whether the docs can be prepared for AI now: preparing reads them with the
 * selected source, so it needs one that works (the reindex is refused otherwise).
 */
export const canPrepare = (ai: SiteAi): boolean => Boolean(ai.status.published) && checklistSource(ai) !== null && sourceProblem(ai) === null;

/** The selected own key is rate-limited by its provider: it still answers, but some readers may get none for now. */
const sourceRateLimited = (ai: SiteAi): boolean => {
  const source = checklistSource(ai);
  return source !== null && source !== 'managed' && connectionOf(ai, source)?.state === 'rateLimited';
};

/** The one fix for the problem the page leads with (the "Not working" callout). */
export function problemFix(ai: SiteAi, problem: AiProblem): ChecklistFix | null {
  if (problem === 'notPublished') return 'publish';
  if (problem === 'limitReached') return 'seeUsage';
  if (problem === 'notPrepared' || problem === 'preparationFailed') return canPrepare(ai) ? 'prepare' : null;
  return SOURCE_FIX[problem] ?? null;
}

/** "Is it working?": each step answers need, with the one fix for a failing step. */
export function checklist(ai: SiteAi): ChecklistRow[] {
  const { status } = ai;
  const prepare: ChecklistFix | null = canPrepare(ai) ? 'prepare' : null;
  const published: ChecklistRow = { id: 'published', tone: status.published ? 'ok' : 'problem', fix: status.published ? null : 'publish' };
  const preparation = status.preparation.state;
  const prepared: ChecklistRow = !status.published
    ? { id: 'prepared', tone: 'idle', fix: null }
    : preparation === 'ready'
      ? { id: 'prepared', tone: 'ok', fix: null }
      : preparation === 'partial'
        ? { id: 'prepared', tone: 'warning', fix: prepare }
        : preparation === 'running'
          ? { id: 'prepared', tone: 'working', fix: null }
          : // Not prepared yet only fails readers once answers are on; turning them on starts it.
            { id: 'prepared', tone: status.answersOn || preparation === 'failed' ? 'problem' : 'idle', fix: prepare };
  const problem = sourceProblem(ai);
  const source: ChecklistRow =
    checklistSource(ai) === null
      ? // Nothing chosen and nothing usable yet (every key still to add): the fix is adding one.
        { id: 'source', tone: 'idle', fix: sourceOptions(ai, 'admin').some((option) => option.decision.kind === 'allowed') ? null : 'addKey' }
      : problem
        ? { id: 'source', tone: 'problem', fix: SOURCE_FIX[problem] ?? null, problem }
        : sourceRateLimited(ai)
          ? { id: 'source', tone: 'warning', fix: null }
          : { id: 'source', tone: status.answersOn ? 'ok' : 'idle', fix: null };
  const usage: ChecklistRow = limitReached(ai)
    ? { id: 'usage', tone: 'problem', fix: 'seeUsage' }
    : { id: 'usage', tone: status.usage.answersToday === null ? 'idle' : 'ok', fix: null };
  return [published, prepared, source, usage];
}

/** What a source choice sends to the server (`PATCH …/settings/ai`). */
export type AiSelectionRequest = {
  providerId: 'instance' | AiKeyProvider | 'disabled';
  answersEnabled: boolean;
  expectedRevision?: number;
};

/**
 * The request that makes `source` the site's source. `answersEnabled` is the
 * value to save: choosing a source passes the current one through, so only the
 * switch (`switchRequest`) ever changes whether readers get answers.
 */
export function selectionRequest(ai: SiteAi, source: AiSource | null, answersEnabled: boolean): AiSelectionRequest {
  if (source === null) return { providerId: 'disabled', answersEnabled: false };
  if (source === 'managed') return { providerId: 'instance', answersEnabled };
  const revision = connectionOf(ai, source)?.revision;
  return { providerId: source, answersEnabled, ...(revision ? { expectedRevision: revision } : {}) };
}

/** Choosing another source in "What powers AI answers": the switch stays where it is. */
export const sourceChoiceRequest = (ai: SiteAi, source: AiSource): AiSelectionRequest => selectionRequest(ai, source, ai.status.answersOn);

/**
 * The one AI answers switch. On: the source `switchDecision` picked. Off: keep
 * the selected source when it can still be chosen (turning on again resumes
 * it), else turn AI off for the site.
 */
export function switchRequest(ai: SiteAi, on: boolean, access: SiteAdminState): AiSelectionRequest | null {
  if (on) {
    const { decision, turnsOnWith } = switchDecision(ai, access);
    return decision.kind === 'allowed' && turnsOnWith ? selectionRequest(ai, turnsOnWith, true) : null;
  }
  const current = sourceOptions(ai, access).find((option) => option.selected && option.decision.kind === 'allowed');
  return selectionRequest(ai, current ? current.id : null, false);
}

/** D10: turning answers on starts preparing the docs right away when they aren't prepared (or the last try failed). */
export const preparesOnTurnOn = (ai: SiteAi): boolean =>
  Boolean(ai.status.published) && (ai.status.preparation.state === 'none' || ai.status.preparation.state === 'failed');
