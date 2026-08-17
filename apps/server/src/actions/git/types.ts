export interface RemoteFile {
  path: string;
  sha: string;
  content: string;
}

export interface CommitFile {
  path: string;
  content: string | null;
}

export interface RemotePullRequest {
  number: number;
  url: string;
  title: string;
  state: string;
  draft: boolean;
  baseBranch: string;
  headBranch: string;
  headSha: string;
}

export interface GitCommitInput {
  repository: string;
  baseSha: string;
  branch: string;
  message: string;
  author: { name: string; email: string };
  files: CommitFile[];
}

/** Provider seam: GitHub is implemented first, while workflow and persistence
 * code depend only on these repository primitives. */
export interface GitProviderClient {
  readonly provider: 'github';
  verifyIdentity(): Promise<{ login: string; name: string | null }>;
  verifyWriteAccess(repository: string): Promise<void>;
  getBranchSha(repository: string, branch: string): Promise<string | null>;
  listMarkdownFiles(repository: string, ref: string, contentPath: string): Promise<RemoteFile[]>;
  createCommit(input: GitCommitInput): Promise<string>;
  createBranch(repository: string, branch: string, sha: string): Promise<void>;
  updateBranch(repository: string, branch: string, sha: string, expectedOldSha: string): Promise<void>;
  upsertDraftPullRequest(input: {
    repository: string;
    baseBranch: string;
    headBranch: string;
    title: string;
    body: string;
  }): Promise<RemotePullRequest>;
  getPullRequest(repository: string, number: number): Promise<RemotePullRequest>;
}
