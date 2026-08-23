import { themeRepositoryOwnershipForPath } from '@nibleaf/shared/theme-repository';
import { Octokit, RequestError } from 'octokit';
import { AppError } from '@/errors';
import type { GitCommitInput, GitProviderClient, RemotePullRequest } from './types';

const BLOB_FETCH_CONCURRENCY = 8;
const MAX_BLOB_SIZE = 2_000_000;
const MAX_TOTAL_BLOB_SIZE = 64 * 1024 * 1024;

type GitHubFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

interface GitHubPull {
  number: number;
  html_url: string;
  title: string;
  state: string;
  draft?: boolean | null;
  base: { ref: string };
  head: { ref: string; sha: string };
}

interface GitHubTreeFile {
  path: string;
  sha: string;
  type: string;
  size?: number;
}

class GitHubProviderError extends AppError {
  readonly providerStatus?: number;

  constructor(message: string, options?: { cause?: unknown; status?: number }) {
    super({
      code: 'provider:unavailable',
      message,
      ...(options?.cause === undefined ? {} : { cause: options.cause }),
      ...(options?.status === undefined ? {} : { details: { provider: 'github', status: options.status } }),
    });
    this.name = 'GitHubProviderError';
    this.providerStatus = options?.status;
  }
}

const mapWithConcurrency = async <T, R>(values: readonly T[], concurrency: number, mapper: (value: T, index: number) => Promise<R>) => {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      results[index] = await mapper(values[index] as T, index);
    }
  });
  await Promise.all(workers);
  return results;
};

const repoParts = (repository: string): [string, string] => {
  const parts = repository.split('/');
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part))) {
    throw new GitHubProviderError('GitHub repository must use owner/repository.');
  }
  return [parts[0] as string, parts[1] as string];
};

const asPullRequest = (value: GitHubPull): RemotePullRequest => ({
  number: value.number,
  url: value.html_url,
  title: value.title,
  state: value.state,
  draft: value.draft === true,
  baseBranch: value.base.ref,
  headBranch: value.head.ref,
  headSha: value.head.sha,
});

export class GitHubProvider implements GitProviderClient {
  readonly provider = 'github' as const;
  private readonly client: Octokit;

  constructor(token: string, request: GitHubFetch = fetch) {
    this.client = new Octokit({ auth: token, request: { fetch: request }, userAgent: 'nibleaf-git-sync' });
  }

  private async request<T>(operation: () => Promise<T>, fallback: string) {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof GitHubProviderError) throw error;
      if (error instanceof RequestError) {
        throw new GitHubProviderError(`GitHub ${error.status}: ${error.message.slice(0, 180)}`, {
          cause: error,
          status: error.status,
        });
      }
      throw new GitHubProviderError(fallback, { cause: error });
    }
  }

  async verifyIdentity() {
    const response = await this.request(() => this.client.rest.users.getAuthenticated(), 'GitHub authorization failed.');
    if (!response.data.login) throw new GitHubProviderError('GitHub authorization did not return an account identity.');
    return { login: response.data.login, name: response.data.name ?? null };
  }

  async verifyWriteAccess(repository: string) {
    const [owner, repo] = repoParts(repository);
    const response = await this.request(() => this.client.rest.repos.get({ owner, repo }), 'Could not inspect the GitHub repository.');
    if (response.data.permissions?.push !== true) {
      throw new GitHubProviderError('The GitHub credential does not have repository contents write access.');
    }
  }

  async getBranchSha(repository: string, branch: string) {
    const [owner, repo] = repoParts(repository);
    try {
      const response = await this.client.rest.git.getRef({ owner, repo, ref: `heads/${branch}` });
      return response.data.object.sha;
    } catch (error) {
      if (error instanceof RequestError && error.status === 404) return null;
      if (error instanceof RequestError) {
        throw new GitHubProviderError(`GitHub ${error.status}: ${error.message.slice(0, 180)}`, { cause: error, status: error.status });
      }
      throw new GitHubProviderError('Could not read the GitHub branch.', { cause: error });
    }
  }

  private async getBlob(repository: string, sha: string) {
    const [owner, repo] = repoParts(repository);
    const response = await this.request(
      () => this.client.rest.git.getBlob({ owner, repo, file_sha: sha }),
      'Could not read a GitHub repository file.',
    );
    if (response.data.encoding !== 'base64') throw new GitHubProviderError('GitHub returned an unsupported blob encoding.');
    return Buffer.from(response.data.content.replace(/\s/g, ''), 'base64').toString('utf8');
  }

  async listMarkdownFiles(repository: string, ref: string, contentPath: string) {
    const prefix = contentPath ? `${contentPath.replace(/^\/+|\/+$/g, '')}/` : '';
    return this.listFiles(repository, ref, (entry) => entry.path.startsWith(prefix) && /\.mdx?$/i.test(entry.path), 2000, 'Markdown');
  }

  async listThemeRepositoryFiles(repository: string, ref: string, contentPath: string) {
    return this.listFiles(repository, ref, (entry) => themeRepositoryOwnershipForPath(entry.path, contentPath) !== null, 2500, 'theme repository');
  }

  private async listFiles(repository: string, ref: string, include: (entry: GitHubTreeFile) => boolean, limit: number, label: string) {
    const [owner, repo] = repoParts(repository);
    const response = await this.request(
      () => this.client.rest.git.getTree({ owner, repo, tree_sha: ref, recursive: 'true' }),
      'Could not list the GitHub repository.',
    );
    if (response.data.truncated) {
      throw new GitHubProviderError('The repository tree is too large for safe Git sync. Narrow the content path.');
    }
    const entries = response.data.tree
      .flatMap((entry) =>
        entry.type === 'blob' && entry.path && entry.sha
          ? [{ path: entry.path, sha: entry.sha, type: entry.type, ...(entry.size === undefined ? {} : { size: entry.size }) }]
          : [],
      )
      .filter(include);
    const unknownSize = entries.find((entry) => entry.size === undefined);
    if (unknownSize) throw new GitHubProviderError(`Git sync cannot safely size ${unknownSize.path}. Refresh the repository tree and try again.`);
    const oversized = entries.find((entry) => (entry.size ?? 0) > MAX_BLOB_SIZE);
    if (oversized) throw new GitHubProviderError(`Git sync cannot read ${oversized.path}: files must be 2 MiB or smaller.`);
    const totalSize = entries.reduce((total, entry) => total + (entry.size ?? 0), 0);
    if (totalSize > MAX_TOTAL_BLOB_SIZE) {
      throw new GitHubProviderError('Git sync is limited to 64 MiB of managed text per connection. Narrow the content path.');
    }
    if (entries.length > limit) {
      throw new GitHubProviderError(`Git sync is limited to ${limit.toLocaleString('en-US')} ${label} files per connection.`);
    }
    // Large documentation repositories can contain thousands of Markdown
    // blobs. Fetch a small parallel window instead of bursting all requests at
    // GitHub at once, which otherwise triggers secondary rate limits and holds
    // thousands of response bodies in memory.
    return mapWithConcurrency(entries, BLOB_FETCH_CONCURRENCY, async (entry) => ({
      path: entry.path,
      sha: entry.sha,
      content: await this.getBlob(repository, entry.sha),
    }));
  }

  private async createBlob(repository: string, content: string) {
    const [owner, repo] = repoParts(repository);
    const response = await this.request(
      () => this.client.rest.git.createBlob({ owner, repo, content, encoding: 'utf-8' }),
      'Could not create a GitHub blob.',
    );
    return response.data.sha;
  }

  async createCommit(input: GitCommitInput) {
    const [owner, repo] = repoParts(input.repository);
    const base = await this.request(
      () => this.client.rest.git.getCommit({ owner, repo, commit_sha: input.baseSha }),
      'Could not read the base GitHub commit.',
    );
    const entries = await Promise.all(
      input.files.map(async (file) => ({
        path: file.path,
        mode: '100644' as const,
        type: 'blob' as const,
        sha: file.content === null ? null : await this.createBlob(input.repository, file.content),
      })),
    );
    const tree = await this.request(
      () => this.client.rest.git.createTree({ owner, repo, base_tree: base.data.tree.sha, tree: entries }),
      'Could not create the GitHub tree.',
    );
    const commit = await this.request(
      () =>
        this.client.rest.git.createCommit({
          owner,
          repo,
          message: input.message,
          tree: tree.data.sha,
          parents: [input.baseSha],
          author: input.author,
        }),
      'Could not create the GitHub commit.',
    );
    return commit.data.sha;
  }

  async createBranch(repository: string, branch: string, sha: string) {
    const [owner, repo] = repoParts(repository);
    await this.request(
      () => this.client.rest.git.createRef({ owner, repo, ref: `refs/heads/${branch}`, sha }),
      'Could not create the GitHub branch.',
    );
  }

  async updateBranch(repository: string, branch: string, sha: string, expectedOldSha: string) {
    const current = await this.getBranchSha(repository, branch);
    if (current !== expectedOldSha) {
      throw new GitHubProviderError('The remote branch changed during the push. Retry after reconciliation.');
    }
    const [owner, repo] = repoParts(repository);
    await this.request(
      () => this.client.rest.git.updateRef({ owner, repo, ref: `heads/${branch}`, sha, force: false }),
      'Could not update the GitHub branch.',
    );
  }

  async upsertDraftPullRequest(input: { repository: string; baseBranch: string; headBranch: string; title: string; body: string }) {
    const [owner, repo] = repoParts(input.repository);
    const existing = await this.request(
      () =>
        this.client.rest.pulls.list({
          owner,
          repo,
          state: 'open',
          head: `${owner}:${input.headBranch}`,
          base: input.baseBranch,
          per_page: 1,
        }),
      'Could not inspect GitHub pull requests.',
    );
    const openPull = existing.data[0];
    if (openPull) {
      const updated = await this.request(
        () =>
          this.client.rest.pulls.update({
            owner,
            repo,
            pull_number: openPull.number,
            title: input.title,
            body: input.body,
            base: input.baseBranch,
          }),
        'Could not update the GitHub pull request.',
      );
      return asPullRequest(updated.data);
    }
    const created = await this.request(
      () =>
        this.client.rest.pulls.create({
          owner,
          repo,
          title: input.title,
          body: input.body,
          head: input.headBranch,
          base: input.baseBranch,
          draft: true,
        }),
      'Could not create the GitHub pull request.',
    );
    return asPullRequest(created.data);
  }

  async getPullRequest(repository: string, number: number) {
    const [owner, repo] = repoParts(repository);
    const response = await this.request(
      () => this.client.rest.pulls.get({ owner, repo, pull_number: number }),
      'Could not read the GitHub pull request.',
    );
    return asPullRequest(response.data);
  }
}
