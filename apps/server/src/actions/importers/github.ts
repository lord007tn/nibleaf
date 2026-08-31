import { Octokit, RequestError } from 'octokit';
import { badRequest } from '@/errors';

const github = new Octokit({ userAgent: 'nibleaf-importer' });

const githubFailure = (error: unknown) => {
  if (error instanceof RequestError) {
    return badRequest(
      error.status === 404
        ? 'Repository or branch not found. Imports support public GitHub repositories only.'
        : `GitHub API error (${error.status}). Try again shortly.`,
      { provider: 'github', providerStatus: error.status },
    );
  }
  return badRequest('Could not reach GitHub. Try again shortly.', { provider: 'github' });
};

/** Recursive tree listing of a public GitHub repository at a branch. */
export const listGitHubFiles = async (owner: string, repo: string, branch: string) => {
  try {
    const response = await github.rest.git.getTree({ owner, repo, tree_sha: branch, recursive: 'true' });
    return response.data.tree.flatMap((entry) =>
      entry.path && (entry.type === 'blob' || entry.type === 'tree') ? [{ path: entry.path, type: entry.type }] : [],
    );
  } catch (error) {
    throw githubFailure(error);
  }
};

/** Default branch of a public GitHub repository (used when the caller omits one). */
export const getGitHubDefaultBranch = async (owner: string, repo: string) => {
  try {
    const response = await github.rest.repos.get({ owner, repo });
    return response.data.default_branch || 'main';
  } catch (error) {
    throw githubFailure(error);
  }
};

/** Read one text file from a public repository through GitHub's raw-content
 * origin. The Contents API allows only 60 unauthenticated requests per hour;
 * a bilingual documentation import can legitimately exceed that by itself.
 * The repository tree is still obtained through GitHub's API first, so callers
 * only request paths that GitHub reported for the selected public revision. */
export const getGitHubTextFile = async (owner: string, repo: string, branch: string, filePath: string) => {
  let response: Response;
  try {
    response = await fetch(githubRawUrl(owner, repo, branch, filePath), {
      headers: { Accept: 'text/plain', 'User-Agent': 'nibleaf-importer' },
      redirect: 'error',
    });
  } catch (error) {
    throw githubFailure(error);
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    throw badRequest(`GitHub raw content error (${response.status}). Try again shortly.`, {
      provider: 'github',
      providerStatus: response.status,
    });
  }
  return await response.text();
};

/** raw.githubusercontent.com URL for a browser-reachable repository asset. */
export const githubRawUrl = (owner: string, repo: string, branch: string, filePath: string) =>
  `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${filePath.split('/').map(encodeURIComponent).join('/')}`;
