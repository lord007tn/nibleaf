import { LANGUAGE_CATALOG } from '@nibleaf/shared/languages';
import { describe, expect, it } from 'vitest';
import { createProjectBody, projectAvailabilityQuery, updateProjectBody } from './index';

describe('site creation', () => {
  it('accepts existing callers and strips whitespace from names', () => {
    expect(createProjectBody.parse({ name: ' Docs ' })).toEqual({ name: 'Docs' });
  });
  it.each(LANGUAGE_CATALOG)('accepts catalog language $code', ({ code }) => {
    expect(createProjectBody.safeParse({ name: 'Docs', language: code }).success).toBe(true);
  });
  it.each(['blank', 'product-docs', 'help-center'])('accepts %s starter', (starter) => {
    expect(createProjectBody.safeParse({ name: 'Docs', starter }).success).toBe(true);
  });
  it.each(['', 'Bad', '-bad', 'bad-', 'a.b', 'a'.repeat(64)])('uses the update slug rules for %s', (slug) => {
    expect(createProjectBody.safeParse({ name: 'Docs', slug }).success).toBe(false);
    expect(updateProjectBody.safeParse({ slug }).success).toBe(false);
    expect(projectAvailabilityQuery.safeParse({ name: 'Docs', slug }).success).toBe(false);
  });
  it.each(['a', 'my-docs', 'a'.repeat(63)])('accepts valid slug %s', (slug) => {
    expect(createProjectBody.safeParse({ name: 'Docs', slug }).success).toBe(true);
  });
  it.each([{ name: ' ' }, { name: 'Docs', language: 'xx' }, { name: 'Docs', starter: 'other' }, { name: 'Docs', unexpected: true }])(
    'rejects invalid and unknown fields: %j',
    (body) => {
      expect(createProjectBody.safeParse(body).success).toBe(false);
    },
  );
});
