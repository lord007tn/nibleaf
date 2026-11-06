import type { AiChatFinalEvent } from '@nibleaf/validators';
import { describe, expect, it } from 'vitest';
import { answerText, buildHistory, citationParts, deriveConsent, errorKey, errorSse, upstreamError } from './helpers';

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
    // Markers mean nothing until the answer is checked.
    expect(answerText('Run it. [S6]\n\nThen this [S1, S2] and [S4; S5].')).toBe('Run it.\n\nThen this and.');
    // Streamed in pieces, a marker never flashes before it closes.
    for (const piece of ['[', '[S', '[S6', '[S6,', '[S6, ', '[S6, S', '[S6, S2', '[S6]']) expect(answerText(`Run it ${piece}`)).toBe('Run it');
    expect(answerText('نعم [S1، S2] تم [S3،')).toBe('نعم تم');
    // Only an unfinished marker at the very end is held back.
    expect(answerText('Use items[0] here')).toBe('Use items[0] here');
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
  it('maps errors to plain language keys', () => {
    expect(errorKey('budget_exhausted')).toBe('aiQuota');
    expect(errorKey('offline')).toBe('aiOffline');
    expect(errorKey('conversation_limit')).toBe('aiLimit');
  });
});
