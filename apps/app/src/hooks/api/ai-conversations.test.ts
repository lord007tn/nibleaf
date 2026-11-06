import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/api-origin', () => ({ apiOrigin: () => 'https://docs.example' }));
vi.mock('@nibleaf/i18n/runtime', () => ({ getLocale: () => 'ar' }));

import { aiConversationsPath } from './ai-conversations';

describe('AI conversation URLs', () => {
  it('encodes project ids, search text and opaque cursors without empty filters', () => {
    const path = aiConversationsPath('project/a', '', { range: '7d', q: 'setup & help', cursor: 'a+/=', language: undefined, rating: '' });
    expect(path).toBe('/api/app/projects/project%2Fa/ai-conversations?range=7d&q=setup+%26+help&cursor=a%2B%2F%3D');
  });
  it('supports summary, gaps, and encoded detail paths', () => {
    expect(aiConversationsPath('p', '/summary', { timezone: 'Europe/Berlin' })).toBe(
      '/api/app/projects/p/ai-conversations/summary?timezone=Europe%2FBerlin',
    );
    expect(aiConversationsPath('p', '/gaps')).toBe('/api/app/projects/p/ai-conversations/gaps');
  });
});
