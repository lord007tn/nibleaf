import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// These workflows cover the three protected-main checks. Look up workflow runs,
// rather than accepting a same-named status from an arbitrary integration.
export const requiredWorkflows = ['ci.yml', 'codeql.yml', 'gitleaks.yml'];

export async function checkSourceCi({ repository, sha, token, fetchImpl = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !/^[0-9a-f]{40}$/.test(sha ?? '') || !token) {
    throw new Error('Source CI gate requires a repository, immutable 40-character SHA and GitHub token.');
  }
  const receipts = [];
  for (const workflow of requiredWorkflows) {
    const url = `https://api.github.com/repos/${repository}/actions/workflows/${workflow}/runs?head_sha=${sha}&per_page=100`;
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Source CI lookup for ${workflow} failed (HTTP ${response.status}).`);
    const body = await response.json();
    if (!Array.isArray(body.workflow_runs)) throw new Error(`Invalid source CI response for ${workflow}.`);
    // The newest attempt wins, even if an older run passed. Scheduled/dispatch
    // runs cannot substitute for the source-triggered checks.
    const run = body.workflow_runs
      .filter((candidate) => candidate.head_sha === sha && ['push', 'pull_request'].includes(candidate.event))
      .sort((a, b) => b.id - a.id)[0];
    if (run?.status !== 'completed' || run.conclusion !== 'success') {
      throw new Error(`Source CI ${workflow} for ${sha}: ${run ? `${run.status}/${run.conclusion}` : 'missing exact-SHA run'}.`);
    }
    receipts.push({ workflow, sha, runId: run.id, conclusion: run.conclusion });
  }
  return receipts;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const receipts = await checkSourceCi({ repository: process.env.GITHUB_REPOSITORY, sha: process.env.SOURCE_SHA, token: process.env.GH_TOKEN });
  process.stdout.write(`${JSON.stringify({ sourceCi: receipts }, null, 2)}\n`);
}
