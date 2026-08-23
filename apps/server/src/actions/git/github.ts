import type { CommitFile, GitCommitInput, GitProviderClient, RemoteFile, RemotePullRequest } from './types';

interface GitHubErrorBody {
  message?: string;
  documentation_url?: string;
}

const BLOB_FETCH_CONCURRENCY = 8;

const mapWithConcurrency = async <T, R>(values: readonly T[], concurrency: number, mapper: (value: T, index: number) => Promise<R>): Promise<R[]> => {
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
    throw new Error('GitHub repository must use owner/repository.');
  }
  return [parts[0] as string, parts[1] as string];
};

const encodePath = (value: string): string => value.split('/').map(encodeURIComponent).join('/');

const asPullRequest = (value: {
  number: number;
  html_url: string;
  title: string;
  state: string;
  draft?: boolean;
  base: { ref: string };
  head: { ref: string; sha: string };
}): RemotePullRequest => ({
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
  constructor(
    private readonly token: string,
    private readonly request: typeof fetch = fetch,
  ) {}

  private async api<T>(repository: string, path: string, init: RequestInit = {}, allowed: number[] = []): Promise<T> {
    const [owner, repo] = repoParts(repository);
    const response = await this.request(`https://api.github.com/repos/${owner}/${repo}${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'nibleaf-git-sync',
        'X-GitHub-Api-Version': '2022-11-28',
        ...init.headers,
      },
      redirect: 'error',
    });
    if (!response.ok && !allowed.includes(response.status)) {
      const body = (await response.json().catch(() => ({}))) as GitHubErrorBody;
      // Never include request headers/token or provider response bodies in the
      // exception: provider messages are bounded and the status is sufficient.
      throw new Error(`GitHub API ${response.status}: ${(body.message ?? 'request failed').slice(0, 180)}`);
    }
    if (response.status === 204 || response.status === 404) {
      return null as T;
    }
    return (await response.json()) as T;
  }

  async verifyIdentity(): Promise<{ login: string; name: string | null }> {
    const response = await this.request('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'nibleaf-git-sync',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      redirect: 'error',
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as GitHubErrorBody;
      throw new Error(`GitHub authorization failed (${response.status}): ${(body.message ?? 'request failed').slice(0, 180)}`);
    }
    const identity = (await response.json()) as { login?: string; name?: string | null };
    if (!identity.login) throw new Error('GitHub authorization did not return an account identity.');
    return { login: identity.login, name: identity.name ?? null };
  }

  async verifyWriteAccess(repository: string): Promise<void> {
    const repo = await this.api<{ permissions?: { push?: boolean } }>(repository, '');
    if (repo.permissions?.push !== true) {
      throw new Error('The GitHub credential does not have repository contents write access.');
    }
  }

  async getBranchSha(repository: string, branch: string): Promise<string | null> {
    const ref = await this.api<{ object: { sha: string } } | null>(repository, `/git/ref/heads/${encodePath(branch)}`, {}, [404]);
    return ref?.object.sha ?? null;
  }

  private async getBlob(repository: string, sha: string): Promise<string> {
    const blob = await this.api<{ content: string; encoding: string }>(repository, `/git/blobs/${encodeURIComponent(sha)}`);
    if (blob.encoding !== 'base64') {
      throw new Error('GitHub returned an unsupported blob encoding.');
    }
    return Buffer.from(blob.content.replace(/\s/g, ''), 'base64').toString('utf8');
  }

  async listMarkdownFiles(repository: string, ref: string, contentPath: string): Promise<RemoteFile[]> {
    const tree = await this.api<{ truncated: boolean; tree: Array<{ path: string; type: string; sha: string; size?: number }> }>(
      repository,
      `/git/trees/${encodeURIComponent(ref)}?recursive=1`,
    );
    if (tree.truncated) {
      throw new Error('The repository tree is too large for safe Git sync. Narrow the content path.');
    }
    const prefix = contentPath ? `${contentPath.replace(/^\/+|\/+$/g, '')}/` : '';
    const entries = tree.tree.filter(
      (entry) => entry.type === 'blob' && entry.path.startsWith(prefix) && /\.mdx?$/i.test(entry.path) && (entry.size ?? 0) <= 2_000_000,
    );
    if (entries.length > 2000) {
      throw new Error('Git sync is limited to 2,000 Markdown files per connection.');
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

  private async createBlob(repository: string, file: Exclude<CommitFile, { content: null }>): Promise<string> {
    const blob = await this.api<{ sha: string }>(repository, '/git/blobs', {
      method: 'POST',
      body: JSON.stringify({ content: file.content, encoding: 'utf-8' }),
    });
    return blob.sha;
  }

  async createCommit(input: GitCommitInput): Promise<string> {
    const base = await this.api<{ tree: { sha: string } }>(input.repository, `/git/commits/${encodeURIComponent(input.baseSha)}`);
    const entries = await Promise.all(
      input.files.map(async (file) => ({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: file.content === null ? null : await this.createBlob(input.repository, file as Exclude<CommitFile, { content: null }>),
      })),
    );
    const tree = await this.api<{ sha: string }>(input.repository, '/git/trees', {
      method: 'POST',
      body: JSON.stringify({ base_tree: base.tree.sha, tree: entries }),
    });
    const commit = await this.api<{ sha: string }>(input.repository, '/git/commits', {
      method: 'POST',
      body: JSON.stringify({ message: input.message, tree: tree.sha, parents: [input.baseSha], author: input.author }),
    });
    return commit.sha;
  }

  async createBranch(repository: string, branch: string, sha: string): Promise<void> {
    await this.api(repository, '/git/refs', { method: 'POST', body: JSON.stringify({ ref: `refs/heads/${branch}`, sha }) });
  }

  async updateBranch(repository: string, branch: string, sha: string, expectedOldSha: string): Promise<void> {
    const current = await this.getBranchSha(repository, branch);
    if (current !== expectedOldSha) {
      throw new Error('The remote branch changed during the push. Retry after reconciliation.');
    }
    await this.api(repository, `/git/refs/heads/${encodePath(branch)}`, { method: 'PATCH', body: JSON.stringify({ sha, force: false }) });
  }

  async upsertDraftPullRequest(input: {
    repository: string;
    baseBranch: string;
    headBranch: string;
    title: string;
    body: string;
  }): Promise<RemotePullRequest> {
    const [owner] = repoParts(input.repository);
    const existing = await this.api<
      Array<{
        number: number;
        html_url: string;
        title: string;
        state: string;
        draft?: boolean;
        base: { ref: string };
        head: { ref: string; sha: string };
      }>
    >(
      input.repository,
      `/pulls?state=open&head=${encodeURIComponent(`${owner}:${input.headBranch}`)}&base=${encodeURIComponent(input.baseBranch)}&per_page=1`,
    );
    if (existing[0]) {
      const updated = await this.api<(typeof existing)[number]>(input.repository, `/pulls/${existing[0].number}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: input.title, body: input.body, base: input.baseBranch }),
      });
      return asPullRequest(updated);
    }
    const created = await this.api<(typeof existing)[number]>(input.repository, '/pulls', {
      method: 'POST',
      body: JSON.stringify({ title: input.title, body: input.body, head: input.headBranch, base: input.baseBranch, draft: true }),
    });
    return asPullRequest(created);
  }

  async getPullRequest(repository: string, number: number): Promise<RemotePullRequest> {
    const pull = await this.api<{
      number: number;
      html_url: string;
      title: string;
      state: string;
      draft?: boolean;
      base: { ref: string };
      head: { ref: string; sha: string };
    }>(repository, `/pulls/${number}`);
    return asPullRequest(pull);
  }
}
