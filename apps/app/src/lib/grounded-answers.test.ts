import { describe, expect, it } from 'vitest';
import { groundedAnswersState } from './grounded-answers';

const base = {
  infrastructureConfigured: true,
  selectedProvider: 'instance',
  instanceConfigured: false,
  instanceAnswersEnabled: false,
  providers: [
    { id: 'openai', verified: false },
    { id: 'openrouter', verified: false },
  ],
};

describe('groundedAnswersState', () => {
  it('is available with the site’s own verified key, even without a server key', () => {
    expect(groundedAnswersState({ ...base, selectedProvider: 'openai', providers: [{ id: 'openai', verified: true }] })).toBe('available');
  });

  it('is available with the server key only when the server allows answers', () => {
    expect(groundedAnswersState({ ...base, instanceConfigured: true, instanceAnswersEnabled: true })).toBe('available');
    expect(groundedAnswersState({ ...base, instanceConfigured: true, instanceAnswersEnabled: false })).toBe('needsConnection');
  });

  it('asks for a connection when the chosen key is unverified, or AI is off', () => {
    expect(groundedAnswersState({ ...base, selectedProvider: 'openrouter' })).toBe('needsConnection');
    expect(groundedAnswersState({ ...base, selectedProvider: 'disabled', providers: [{ id: 'openai', verified: true }] })).toBe('needsConnection');
  });

  it('points to the server administrator when there is no search index', () => {
    expect(
      groundedAnswersState({ ...base, infrastructureConfigured: false, selectedProvider: 'openai', providers: [{ id: 'openai', verified: true }] }),
    ).toBe('needsServer');
  });

  it('is pending until Smart AI has loaded', () => {
    expect(groundedAnswersState(undefined)).toBe('pending');
  });
});
