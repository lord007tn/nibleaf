import got from 'got';
import { z } from 'zod';
import { badRequest } from '@/errors';

/**
 * Public-GitHub fetch helpers shared by the Git import and the Mintlify
 * importer. Public repositories only — same guard messaging everywhere.
 */

const GITHUB_HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': 'nibleaf' } as const;

/** Recursive tree listing of a public GitHub repository at a branch. */
export const listGitHubFiles = async (owner: string, repo: string, branch: string) => {
  const response = await got(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, {
    headers: GITHUB_HEADERS,
    responseType: 'json',
    retry: { limit: 1 },
    throwHttpErrors: false,
  });
  if (!response.ok) {
    throw badRequest(
      response.statusCode === 404
        ? 'Repository or branch not found. Imports support public GitHub repositories only.'
        : `GitHub API error (${response.statusCode}). Try again shortly.`,
    );
  }
  const parsed = z.object({ tree: z.array(z.object({ path: z.string(), type: z.enum(['blob', 'tree']) })).default([]) }).safeParse(response.body);
  if (!parsed.success) throw badRequest('GitHub returned an invalid repository tree. Try again shortly.');
  return parsed.data.tree;
};

/** Default branch of a public GitHub repository (used when the caller omits one). */
export const getGitHubDefaultBranch = async (owner: string, repo: string) => {
  const response = await got(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: GITHUB_HEADERS,
    responseType: 'json',
    retry: { limit: 1 },
    throwHttpErrors: false,
  });
  if (!response.ok) {
    throw badRequest(
      response.statusCode === 404
        ? 'Repository or branch not found. Imports support public GitHub repositories only.'
        : `GitHub API error (${response.statusCode}). Try again shortly.`,
    );
  }
  return z.object({ default_branch: z.string().default('main') }).parse(response.body).default_branch;
};

/** raw.githubusercontent.com URL for one file of a public repository. */
export const githubRawUrl = (owner: string, repo: string, branch: string, filePath: string) =>
  `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${filePath.split('/').map(encodeURIComponent).join('/')}`;

/** Fetch a raw file; `null` on any non-2xx so callers can warn-and-skip. */
export const fetchRawText = async (url: string) => {
  const response = await got(url, { headers: { 'User-Agent': 'nibleaf' }, retry: { limit: 1 }, throwHttpErrors: false });
  return response.ok ? response.body : null;
};
