import { gitbookImportBody, mintlifyImportBody } from '@nibleaf/validators';
import { describe, expect, it } from 'vitest';
import { isRepositoryImportFor, normalizeGithubRepo, type RepositoryImportFields, repositoryImportRequest } from './repository-import';

const fields = (overrides: Partial<RepositoryImportFields> = {}): RepositoryImportFields => ({
  provider: 'mintlify',
  repo: 'acme/handbook',
  branch: '',
  sourceUrl: '',
  path: '',
  replaceExisting: false,
  ...overrides,
});

describe('repository import preparation', () => {
  it.each([
    ['acme/handbook', 'acme/handbook'],
    ['  acme/handbook  ', 'acme/handbook'],
    ['https://github.com/acme/handbook', 'acme/handbook'],
    ['http://www.github.com/acme/handbook/', 'acme/handbook'],
    ['HTTPS://GitHub.com/acme/handbook.git', 'acme/handbook'],
    ['acme/handbook.GIT', 'acme/handbook'],
    ['/acme/handbook/', 'acme/handbook'],
    ['https://gitlab.com/acme/handbook', 'https://gitlab.com/acme/handbook'],
    ['github.com/acme/handbook', 'github.com/acme/handbook'],
  ])('normalizes %j to %j', (input, repo) => {
    expect(normalizeGithubRepo(input)).toBe(repo);
  });

  it('leaves out empty optional fields, and always sends replaceExisting as chosen', () => {
    expect(repositoryImportRequest('site-a', fields({ branch: '   ', sourceUrl: ' ', path: ' / ' }))).toEqual({
      request: { projectId: 'site-a', provider: 'mintlify', body: { repo: 'acme/handbook', replaceExisting: false } },
    });
    expect(repositoryImportRequest('site-a', fields({ provider: 'gitbook', path: ' / ', replaceExisting: true }))).toEqual({
      request: { projectId: 'site-a', provider: 'gitbook', body: { repo: 'acme/handbook', replaceExisting: true } },
    });
  });

  it('trims the branch and source URL, and the GitBook path with its surrounding slashes; Mintlify sends no path', () => {
    const typed = { branch: ' release/v2 ', sourceUrl: ' https://help.example.com/docs ', path: '  //spaces/guides//  ' };
    expect(repositoryImportRequest('site-a', fields({ provider: 'gitbook', ...typed }))).toEqual({
      request: {
        projectId: 'site-a',
        provider: 'gitbook',
        body: {
          sourceUrl: 'https://help.example.com/docs',
          repo: 'acme/handbook',
          branch: 'release/v2',
          replaceExisting: false,
          path: 'spaces/guides',
        },
      },
    });
    expect(repositoryImportRequest('site-a', fields(typed)).request?.body).toEqual({
      sourceUrl: 'https://help.example.com/docs',
      repo: 'acme/handbook',
      branch: 'release/v2',
      replaceExisting: false,
    });
  });

  it('refuses the repository first, then the source URL', () => {
    expect(repositoryImportRequest('site-a', fields({ repo: 'acme', sourceUrl: 'ftp://x' }))).toEqual({
      refusal: 'settings.import.mintlify.invalidRepo',
    });
    expect(repositoryImportRequest('site-a', fields({ repo: 'acme/docs/extra' }))).toEqual({ refusal: 'settings.import.mintlify.invalidRepo' });
    expect(repositoryImportRequest('site-a', fields({ sourceUrl: 'https://user:secret@help.example.com' }))).toEqual({
      refusal: 'settings.import.sourceUrl',
    });
    expect(repositoryImportRequest('site-a', fields({ provider: 'gitbook', sourceUrl: 'help.example.com' }))).toEqual({
      refusal: 'settings.import.sourceUrl',
    });
  });

  it.each([
    ['mintlify', mintlifyImportBody],
    ['gitbook', gitbookImportBody],
  ] as const)('sends %s bodies the server validator accepts unchanged', (provider, validator) => {
    for (const typed of [
      fields({ provider }),
      fields({ provider, repo: 'https://github.com/acme/handbook.git', branch: ' main ', replaceExisting: true }),
      fields({ provider, sourceUrl: ' http://help.example.com/ ', path: ' /docs/guides/ ' }),
    ]) {
      const body = repositoryImportRequest('site-a', typed).request?.body;
      expect(validator.parse(body)).toEqual(body);
    }
  });

  it.each([
    'https://help.example.com',
    'http://help.example.com/docs?lang=ar',
    'https://user@help.example.com',
    'https://user:secret@help.example.com',
    'ftp://help.example.com',
    'javascript:alert(1)',
    'help.example.com',
  ])('refuses the source URL %j exactly when the server validator would', (sourceUrl) => {
    const { refusal } = repositoryImportRequest('site-a', fields({ sourceUrl }));
    expect(refusal === undefined).toBe(mintlifyImportBody.safeParse({ repo: 'acme/handbook', sourceUrl }).success);
  });

  it('matches pending requests by site and provider, not Ghost imports', () => {
    expect(isRepositoryImportFor({ projectId: 'site-a', provider: 'gitbook', body: {} }, 'site-a')).toBe(true);
    expect(isRepositoryImportFor({ projectId: 'site-a', provider: 'mintlify', body: {} }, 'site-b')).toBe(false);
    expect(isRepositoryImportFor({ projectId: 'site-a', body: {} }, 'site-a')).toBe(false);
    expect(isRepositoryImportFor(undefined, 'site-a')).toBe(false);
  });
});
