/**
 * Preparing a Mintlify or GitBook import, as pure logic: what is refused before
 * anything is sent, and the request built from the fields as they were when
 * Import was pressed. Driven by `components/use-repository-import.ts`; tested
 * in `repository-import.test.ts`.
 *
 * The server's validators stay the authority on the body; here only what the
 * form has always checked is refused, and nothing is transformed beyond the
 * trimming and normalizing the form has always done.
 */
import type { MessageKey } from '@nibleaf/i18n';
import type { GitbookImportBody, MintlifyImportBody } from '@nibleaf/validators';
import { isValidImportUrl } from './ghost-import';

/** Sources imported from a public GitHub repository (owner/repo + branch). */
export type RepositoryImportProvider = 'mintlify' | 'gitbook';

/** The form's fields as they were when Import was pressed. */
export type RepositoryImportFields = {
  provider: RepositoryImportProvider;
  repo: string;
  branch: string;
  sourceUrl: string;
  /** GitBook only: one space's directory in the repository. */
  path: string;
  replaceExisting: boolean;
};

/** A repository import as sent. It names the site it is for, whatever the page shows by the time it settles. */
export type RepositoryImportRequest =
  | { projectId: string; provider: 'mintlify'; body: MintlifyImportBody }
  | { projectId: string; provider: 'gitbook'; body: GitbookImportBody };

export const isRepositoryImportProvider = (value: unknown): value is RepositoryImportProvider => value === 'mintlify' || value === 'gitbook';

/** `owner/repo` from what people paste: a GitHub URL, a `.git` clone URL, or `owner/repo` itself. */
export const normalizeGithubRepo = (value: string): string =>
  value
    .trim()
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');

/**
 * The request for the fields, or why it is refused before sending (the
 * repository first, then the source URL). Empty optional fields are left out.
 */
export const repositoryImportRequest = (
  projectId: string,
  fields: RepositoryImportFields,
): { request: RepositoryImportRequest; refusal?: never } | { request?: never; refusal: MessageKey } => {
  const repo = normalizeGithubRepo(fields.repo);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return { refusal: 'settings.import.mintlify.invalidRepo' };
  const sourceUrl = fields.sourceUrl.trim();
  if (sourceUrl && !isValidImportUrl(sourceUrl)) return { refusal: 'settings.import.sourceUrl' };
  const branch = fields.branch.trim();
  const body = {
    ...(sourceUrl ? { sourceUrl } : {}),
    repo,
    ...(branch ? { branch } : {}),
    replaceExisting: fields.replaceExisting,
  };
  if (fields.provider === 'mintlify') return { request: { projectId, provider: 'mintlify', body } };
  const path = fields.path.trim().replace(/^\/+|\/+$/g, '');
  return { request: { projectId, provider: 'gitbook', body: { ...body, ...(path ? { path } : {}) } } };
};

/** Whether a pending request (as the mutation cache holds it) is a repository import for this site. */
export const isRepositoryImportFor = (variables: unknown, projectId: string): boolean =>
  typeof variables === 'object' &&
  variables !== null &&
  (variables as Record<string, unknown>).projectId === projectId &&
  isRepositoryImportProvider((variables as Record<string, unknown>).provider);
