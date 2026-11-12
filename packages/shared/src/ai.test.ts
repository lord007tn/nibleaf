import { describe, expect, it } from 'vitest';
import { aiModelLabel } from './ai';

describe('aiModelLabel', () => {
  it.each([
    ['openai/gpt-6-luna', 'GPT-6 Luna'],
    ['gpt-6-luna', 'GPT-6 Luna'],
    ['openai/gpt-6-terra', 'GPT-6 Terra'],
    ['openai/text-embedding-3-large', 'OpenAI text embeddings (large)'],
  ])('names %s as %s', (id, label) => {
    expect(aiModelLabel(id)).toBe(label);
  });

  it('falls back to the id without its provider prefix', () => {
    expect(aiModelLabel('anthropic/claude-sonnet-5-5')).toBe('claude-sonnet-5-5');
    expect(aiModelLabel('some-model')).toBe('some-model');
  });

  it('never returns an empty name', () => {
    expect(aiModelLabel('provider/')).toBe('provider/');
  });
});

describe('aiModelLabel and object keys', () => {
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])('never reads a label off the prototype for %s', (id) => {
    expect(aiModelLabel(id)).toBe(id);
    expect(aiModelLabel(`provider/${id}`)).toBe(id);
  });
});
