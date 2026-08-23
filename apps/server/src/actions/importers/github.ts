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

/** Read one text file from a public repository through GitHub's official SDK. */
export const getGitHubTextFile = async (owner: string, repo: string, branch: string, filePath: string) => {
  try {
    const response = await github.request('GET /repos/{owner}/{repo}/contents/{path}', {
      owner,
      repo,
      path: filePath,
      ref: branch,
      mediaType: { format: 'raw' },
    });
    return String(response.data);
  } catch (error) {
    if (error instanceof RequestError && error.status === 404) return null;
    throw githubFailure(error);
  }
};

/** raw.githubusercontent.com URL for a browser-reachable repository asset. */
export const githubRawUrl = (owner: string, repo: string, branch: string, filePath: string) =>
  `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${filePath.split('/').map(encodeURIComponent).join('/')}`;
