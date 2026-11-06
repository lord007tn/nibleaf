import type { AiChatFinalEvent } from '@nibleaf/validators';
import { describe, expect, it } from 'vitest';
import { answerText, askSearchSchema, buildHistory, citationParts, deriveConsent, errorKey, errorSse, upstreamError } from './helpers';

const final = { answer: 'Verified [S1]' } as AiChatFinalEvent;
describe('reader chat boundaries', () => {
  it('synthesizes ordered AG-UI error events', () => {
    const events = errorSse('conversation', 'run', 'rate_limited')
      .trim()
      .split('\n\n')
      .map((line) => JSON.parse(line.slice(6)));
    expect(events).toEqual([
      { type: 'RUN_STARTED', threadId: 'conversation', runId: 'run' },
      { type: 'CUSTOM', name: 'nibleaf.chat.error', value: { code: 'rate_limited' } },
      { type: 'RUN_ERROR', code: 'rate_limited', message: 'Unable to answer.' },
    ]);
    expect([429, 400, 422, 404, 503, 500].map(upstreamError)).toEqual([
      'rate_limited',
      'invalid_request',
      'invalid_request',
      'unavailable',
      'unavailable',
      'failed',
    ]);
  });
  it('uses validated finals and bounds history', () => {
    const history = buildHistory(Array.from({ length: 8 }, (_, i) => ({ question: `Question ${i}`, final: { ...final, answer: 'x'.repeat(4100) } })));
    expect(history).toHaveLength(12);
    expect(history[0]).toEqual({ role: 'user', content: 'Question 2' });
    expect(history[1]?.content).toHaveLength(4000);
    expect(answerText('Unverified draft', final)).toBe('Verified [S1]');
    expect(answerText('draft')).toBe('draft');
  });
  it('mirrors consent including blocked storage', () => {
    expect(deriveConsent(false, 'declined')).toBe('not_required');
    expect(deriveConsent(true, 'accepted')).toBe('granted');
    expect(deriveConsent(true, 'declined')).toBe('denied');
    expect(deriveConsent(true, null)).toBe('unknown');
  });
  it('recognizes only citation markers', () => {
    expect(
      citationParts('One [S1], [P1] and [S2]')
        .filter((part) => part.source)
        .map((part) => part.source),
    ).toEqual(['S1', 'S2']);
  });
  it('parses bounded deep links without breaking the route', () => {
    expect(askSearchSchema.parse('  How?  ')).toBe('How?');
    for (const value of ['', 'x', 'a'.repeat(501), 42, []]) expect(askSearchSchema.parse(value)).toBeUndefined();
  });
  it('maps errors to plain language keys', () => {
    expect(errorKey('budget_exhausted')).toBe('aiQuota');
    expect(errorKey('offline')).toBe('aiOffline');
    expect(errorKey('conversation_limit')).toBe('aiLimit');
  });
});
