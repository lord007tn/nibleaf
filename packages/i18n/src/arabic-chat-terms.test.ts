import { describe, expect, it } from 'vitest';
import ar from '../messages/ar.json';

/** The reader chat's Arabic copy (the panel's keys and the server's refusal). */
const chatEntries = Object.entries(ar as Record<string, unknown>).filter(([key]) => key.startsWith('site_ai_') || key === 'site_noanswergrounded');

describe('Arabic reader chat terminology', () => {
  it('calls the docs «التوثيق» everywhere, as the Arabic glossary does', () => {
    expect(chatEntries.length).toBeGreaterThan(40);
    const other = chatEntries.filter(([, value]) => /الوثائق|الدليل/.test(JSON.stringify(value))).map(([key]) => key);
    expect(other).toEqual([]);
    expect(chatEntries.filter(([, value]) => JSON.stringify(value).includes('التوثيق')).length).toBeGreaterThanOrEqual(8);
  });
});
