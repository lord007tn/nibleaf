import { badRequest } from '@/errors';

/**
 * Public-GitHub fetch helpers shared by the Git import and the Mintlify
 * importer. Public repositories only — same guard messaging everywhere.
 */

export interface GitTreeItem {
  path: string;
  type: 'blob' | 'tree';
}

const GITHUB_HEADERS = { Accept: 'application/vnd.github+json', 'User-Agent': 'nibleaf-docs' } as const;

/** Recursive tree listing of a public GitHub repository at a branch. */
export const listGitHubFiles = async (owner: string, repo: string, branch: string): Promise<GitTreeItem[]> => {
  const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, {
    headers: GITHUB_HEADERS,
  });
  if (!treeRes.ok) {
    throw badRequest(
      treeRes.status === 404
        ? 'Repository or branch not found. Imports support public GitHub repositories only.'
        : `GitHub API error (${treeRes.status}). Try again shortly.`,
    );
  }
  const tree = (await treeRes.json()) as { tree?: GitTreeItem[] };
  return tree.tree ?? [];
};

/** Default branch of a public GitHub repository (used when the caller omits one). */
export const getGitHubDefaultBranch = async (owner: string, repo: string): Promise<string> => {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: GITHUB_HEADERS });
  if (!res.ok) {
    throw badRequest(
      res.status === 404
        ? 'Repository or branch not found. Imports support public GitHub repositories only.'
        : `GitHub API error (${res.status}). Try again shortly.`,
    );
  }
  const meta = (await res.json()) as { default_branch?: string };
  return meta.default_branch || 'main';
};

/** raw.githubusercontent.com URL for one file of a public repository. */
export const githubRawUrl = (owner: string, repo: string, branch: string, filePath: string): string =>
  `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${filePath.split('/').map(encodeURIComponent).join('/')}`;

/** Fetch a raw file; `null` on any non-2xx so callers can warn-and-skip. */
export const fetchRawText = async (url: string): Promise<string | null> => {
  const res = await fetch(url, { headers: { 'User-Agent': 'nibleaf-docs' } });
  return res.ok ? res.text() : null;
};
