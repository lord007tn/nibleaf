import { describe, expect, it } from 'vitest';
import { aiChatFinalEventSchema } from './ai-chat';
import { aiSupportUrlSchema, projectConfigSchema } from './index';

describe('reader action URLs', () => {
  it.each(['https://example.com/help', 'mailto:help@example.com'])('trims and retains support URLs: %s', (url) => {
    expect(aiSupportUrlSchema.parse(` \t${url}\r\n`)).toBe(url);
    expect(projectConfigSchema.parse({ search: { aiSupportUrl: `  ${url}  ` } }).search?.aiSupportUrl).toBe(url);
  });

  it.each(['javascript:alert(1)', 'java\tscript:alert(1)', '\u0001javascript:alert(1)', 'data:text/html,test', '//other.example', 'file:///tmp'])(
    'rejects %s in action fields',
    (value) => {
      expect(projectConfigSchema.safeParse({ addons: { editUrl: value } }).success).toBe(false);
      expect(projectConfigSchema.safeParse({ addons: { issueUrl: value } }).success).toBe(false);
      expect(projectConfigSchema.safeParse({ search: { aiSupportUrl: value } }).success).toBe(false);
    },
  );

  it.each(['https://example.com/edit/{path}', 'http://example.com/issues?url={url}', ''])(
    'allows configured HTTP actions and empty fields: %s',
    (value) => {
      expect(projectConfigSchema.safeParse({ addons: { editUrl: value, issueUrl: value } }).success).toBe(true);
    },
  );

  it('allows mailto only for human support', () => {
    expect(projectConfigSchema.safeParse({ search: { aiSupportUrl: 'mailto:help@example.com' } }).success).toBe(true);
    expect(projectConfigSchema.safeParse({ addons: { editUrl: 'mailto:help@example.com' } }).success).toBe(false);
  });

  it('validates the support URL in the emitted chat contract', () => {
    const event = {
      status: 'no_answer',
      conversationId: '00000000-0000-4000-8000-000000000001',
      turnId: '00000000-0000-4000-8000-000000000002',
      answer: 'Get help',
      feedbackToken: 'a'.repeat(16),
      language: 'en',
      limits: { turnsRemaining: 1, quotaRemaining: 1 },
      citations: [],
      suggestions: [],
      supportUrl: 'javascript:alert(1)',
    };
    const result = aiChatFinalEventSchema.safeParse(event);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.path.includes('supportUrl'))).toBe(true);
  });
});
