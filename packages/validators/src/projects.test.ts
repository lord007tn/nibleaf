import { LANGUAGE_CATALOG } from '@nibleaf/shared/languages';
import { describe, expect, it } from 'vitest';
import { createProjectBody, projectAvailabilityQuery, updateProjectBody } from './index';

describe('site creation', () => {
  it('accepts existing callers and strips whitespace from names', () => {
    expect(createProjectBody.parse({ name: ' Docs ' })).toEqual({ name: 'Docs' });
  });
  it('keeps every site-creation language from the catalog', () => {
    for (const { code } of LANGUAGE_CATALOG) {
      expect(createProjectBody.parse({ name: 'Docs', language: code }).language).toBe(code);
    }
  });
  it.each(['blank', 'product-docs', 'help-center'])('accepts %s starter', (starter) => {
    expect(createProjectBody.safeParse({ name: 'Docs', starter }).success).toBe(true);
  });
  it.each(['', 'Docs', '-docs', 'docs-', 'docs.example', 'docs_site', 'a'.repeat(64)])('uses the update slug rules for %s', (slug) => {
    expect(createProjectBody.safeParse({ name: 'Docs', slug }).success).toBe(false);
    expect(updateProjectBody.safeParse({ slug }).success).toBe(false);
    expect(projectAvailabilityQuery.safeParse({ name: 'Docs', slug }).success).toBe(false);
  });
  it.each(['a', 'a'.repeat(63)])('accepts valid slug %s', (slug) => {
    expect(createProjectBody.safeParse({ name: 'Docs', slug }).success).toBe(true);
  });
  it.each([{ name: ' ' }, { name: 'Docs', language: 'xx' }, { name: 'Docs', starter: 'other' }, { name: 'Docs', unexpected: true }])(
    'rejects invalid and unknown fields: %j',
    (body) => {
      expect(createProjectBody.safeParse(body).success).toBe(false);
    },
  );
  it('preserves an Arabic display name with or without a supplied address', () => {
    const name = 'وثائق جود 263';
    const slug = 'site-178xry5';
    expect(createProjectBody.parse({ name })).toEqual({ name });
    expect(createProjectBody.parse({ name, slug })).toEqual({ name, slug });
    expect(projectAvailabilityQuery.parse({ name, slug })).toMatchObject({ name, slug });
  });
  it('still permits a numeric address when the author explicitly chooses it', () => {
    expect(createProjectBody.parse({ name: 'وثائق جود 263', slug: '263' }).slug).toBe('263');
  });
  it.each(['www', 'admin', 'api', 'app', 'docs', 'storage', 'cname', 'status', 'mail', 'xn--nibleaf'])(
    'rejects reserved hostname %s on creation',
    (slug) => {
      expect(createProjectBody.safeParse({ name: 'Site', slug }).success).toBe(false);
    },
  );
  it.each(['docs', 'xn--80ak6aa92e'])('also rejects reserved hostname %s in address availability checks', (slug) => {
    expect(projectAvailabilityQuery.safeParse({ name: 'Site', slug }).success).toBe(false);
  });
  // An update may carry the address the site already has, even one reserved
  // after it was given; the API refuses a reserved address only as a change.
  it('leaves reservation on update to the API, which knows the current address', () => {
    expect(updateProjectBody.parse({ slug: 'docs' }).slug).toBe('docs');
    expect(updateProjectBody.parse({ slug: 'docs-v2' }).slug).toBe('docs-v2');
  });
});
