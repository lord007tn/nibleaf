import { LANGUAGE_CATALOG } from '@nibleaf/shared/languages';
import { deriveSiteSlug } from '@nibleaf/shared/site-slug';
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
  it.each([
    ['مركز المساعدة', 'site-0s7xtf9'],
    ['وثائق جود 263', 'site-178xry5'],
    ['Jood وثائق', 'jood'],
    ['Acme Docs', 'acme-docs'],
  ])('accepts the display name and its derived address: %s', (name, slug) => {
    const body = createProjectBody.parse({ name });
    expect(body.name).toBe(name);
    expect(body.slug).toBeUndefined();
    expect(deriveSiteSlug(body.name).slug).toBe(slug);
    expect(createProjectBody.parse({ ...body, slug }).slug).toBe(slug);
    expect(projectAvailabilityQuery.parse({ name, slug }).slug).toBe(slug);
  });
  it('still permits a numeric address when the author explicitly chooses it', () => {
    expect(createProjectBody.parse({ name: 'وثائق جود 263', slug: '263' }).slug).toBe('263');
  });
  it.each(
    ['www', 'admin', 'api', 'app', 'docs', 'storage', 'cname', 'status', 'mail', 'xn--nibleaf', 'xn--80ak6aa92e'].flatMap((slug) =>
      (['create', 'availability'] as const).map((path) => ({ slug, path })),
    ),
  )('rejects reserved hostname $slug on $path', ({ slug, path }) => {
    const schema = path === 'create' ? createProjectBody : projectAvailabilityQuery;
    expect(schema.safeParse({ name: 'Site', slug }).success).toBe(false);
  });
  // An update may carry the address the site already has, even one reserved
  // after it was given; the API refuses a reserved address only as a change.
  it('leaves reservation on update to the API, which knows the current address', () => {
    expect(updateProjectBody.safeParse({ slug: 'docs' }).success).toBe(true);
  });
  it.each(['', 'Docs', '-docs', 'docs-', 'docs_site', 'a'.repeat(64)])('rejects the malformed address %j on update', (slug) => {
    expect(updateProjectBody.safeParse({ slug }).success).toBe(false);
  });
});
