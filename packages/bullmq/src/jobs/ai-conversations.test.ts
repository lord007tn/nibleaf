import { describe, expect, it } from 'vitest';
import { openAiConversation, resolveAiConversationKey, resolveAiConversationTransportKey, sealAiConversation } from './ai-conversations';

describe('archive envelopes', () => {
  it('seals metadata with a separate salt-derived key without enabling transcript capture', () => {
    const config = { ANALYTICS_HASH_SALT: 'test-salt' };
    expect(resolveAiConversationKey({})).toBeNull();
    const key = resolveAiConversationTransportKey(config);
    expect(openAiConversation(sealAiConversation({ content_captured: 0 }, 't', 'p', key), 't', 'p', key)).toEqual({ content_captured: 0 });
  });
  const key = Buffer.alloc(32, 7);
  it('reads queued jobs with the previous key during rotation without weakening scope or integrity', () => {
    const current = Buffer.alloc(32, 9);
    const sealed = sealAiConversation({ question: 'old queued turn' }, 'tenant', 'project', key);
    expect(openAiConversation(sealed, 'tenant', 'project', current, key)).toEqual({ question: 'old queued turn' });
    expect(() => openAiConversation(sealed, 'other', 'project', current, key)).toThrow();
    expect(() => openAiConversation(sealed, 'tenant', 'other', current, key)).toThrow();
    expect(() => openAiConversation(sealed, 'tenant', 'project', current, Buffer.alloc(32, 2))).toThrow();
    const fresh = sealAiConversation({ fresh: true }, 'tenant', 'project', current);
    expect(() => openAiConversation(fresh, 'tenant', 'project', key)).toThrow();
    expect(openAiConversation(fresh, 'tenant', 'project', current, key)).toEqual({ fresh: true });
  });
  it('round trips with authenticated tenant and project', () => {
    const value = { question: 'redacted text' };
    const sealed = sealAiConversation(value, 'tenant', 'project', key);
    expect(sealed).not.toContain('redacted');
    expect(openAiConversation(sealed, 'tenant', 'project', key)).toEqual(value);
    expect(() => openAiConversation(sealed, 'other', 'project', key)).toThrow();
    expect(() => openAiConversation(sealed, 'tenant', 'other', key)).toThrow();
    expect(() => openAiConversation(sealed, 'tenant', 'project', Buffer.alloc(32, 8))).toThrow();
  });
  it('rejects tampering', () => {
    const sealed = sealAiConversation({ a: 1 }, 't', 'p', key).split('.');
    sealed[2] = Buffer.alloc(16).toString('base64url');
    expect(() => openAiConversation(sealed.join('.'), 't', 'p', key)).toThrow();
  });
  it('derives a purpose separated fallback and rejects invalid keys', () => {
    const derived = resolveAiConversationKey({ INTEGRATION_CREDENTIAL_ENCRYPTION_KEY: key.toString('base64') });
    expect(derived?.length).toBe(32);
    expect(derived).not.toEqual(key);
    expect(resolveAiConversationKey({})).toBeNull();
    expect(() => resolveAiConversationKey({ AI_CONVERSATION_ENCRYPTION_KEY: 'bad' })).toThrow();
  });
});
