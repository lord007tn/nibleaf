/**
 * The words for what `ai.ts` decides (operations/ux/ai-and-integrations.md §5.1):
 * plain data, so components only look them up. Placeholders: {provider},
 * {limit}, {source}.
 */
import type { MessageKey } from '@nibleaf/i18n';
import type { AiBlockReason, AiPageState, AiProblem, AiSource, ChecklistFix } from './ai';

export const SOURCE_NAME: Record<AiSource, MessageKey> = {
  managed: 'settings.ai.source.managed',
  openai: 'settings.ai.source.openai',
  openrouter: 'settings.ai.source.openrouter',
};

export const SOURCE_HINT: Record<AiSource, MessageKey> = {
  managed: 'settings.ai.source.managedHint',
  openai: 'settings.ai.source.openaiHint',
  openrouter: 'settings.ai.source.openrouterHint',
};

/** Company names, which every language keeps as they are. */
export const PROVIDER_NAME = { openai: 'OpenAI', openrouter: 'OpenRouter' } as const;

export const REASON: Record<AiBlockReason, MessageKey> = {
  serverUnavailable: 'settings.ai.reason.serverUnavailable',
  publishFirst: 'settings.ai.reason.publishFirst',
  addKeyFirst: 'settings.ai.reason.addKeyFirst',
  keyNotWorking: 'settings.ai.reason.keyNotWorking',
};

/** The sentence for the one thing stopping answers, on the danger callout and its checklist row. */
export const PROBLEM: Record<AiProblem, MessageKey> = {
  keyMissing: 'settings.ai.problem.keyMissing',
  keyRejected: 'settings.ai.problem.keyRejected',
  keyOutOfCredit: 'settings.ai.problem.keyOutOfCredit',
  keyUnreachable: 'settings.ai.problem.keyUnreachable',
  modelWithdrawn: 'settings.ai.problem.modelWithdrawn',
  sourceNotOffered: 'settings.ai.problem.sourceNotOffered',
  keyNeedsRecheck: 'settings.ai.problem.keyNeedsRecheck',
  keyUnreadable: 'settings.ai.problem.keyUnreadable',
  managedUnavailable: 'settings.ai.problem.managedUnavailable',
  notPublished: 'settings.ai.reason.publishFirst',
  notPrepared: 'settings.ai.problem.notPrepared',
  preparationFailed: 'settings.ai.problem.preparationFailed',
  limitReached: 'settings.ai.problem.limitReached',
};

export const FIX: Record<ChecklistFix, MessageKey> = {
  publish: 'settings.ai.fix.publish',
  prepare: 'settings.ai.fix.prepare',
  replaceKey: 'settings.ai.fix.replaceKey',
  addKey: 'settings.ai.key.add',
  checkKey: 'settings.ai.fix.checkKey',
  checkAgain: 'settings.ai.fix.checkAgain',
  changeModel: 'settings.ai.fix.changeModel',
  chooseSource: 'settings.ai.fix.chooseSource',
  seeUsage: 'settings.ai.fix.seeUsage',
};

/** The switch row: its badge and the line under it, by page state. */
export const STATE: Record<Exclude<AiPageState['kind'], 'unavailable'>, { badge: MessageKey; line: MessageKey }> = {
  off: { badge: 'settings.ai.state.off', line: 'settings.ai.switch.off' },
  on: { badge: 'settings.ai.state.on', line: 'settings.ai.switch.on' },
  preparing: { badge: 'settings.ai.state.preparing', line: 'settings.ai.switch.preparing' },
  notWorking: { badge: 'settings.ai.state.notWorking', line: 'settings.ai.switch.notWorking' },
};

/** The status badge tone per page state. */
export const STATE_TONE = { off: 'neutral', on: 'success', preparing: 'pending', notWorking: 'danger' } as const;
