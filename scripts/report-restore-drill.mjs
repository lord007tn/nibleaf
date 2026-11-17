import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { stripVTControlCharacters } from 'node:util';

const title = 'Self-host restore drill failures';
const runGh = (args, input) => execFileSync('gh', args, { input, encoding: 'utf8' });

export const reportRestoreFailure = ({ repository, runUrl, log }, gh = runGh) => {
  if (!repository || !runUrl) throw new Error('Repository and restore drill run URL are required.');
  const issues = JSON.parse(
    gh([
      'issue',
      'list',
      '--repo',
      repository,
      '--state',
      'all',
      '--search',
      `"${title}" in:title`,
      '--limit',
      '100',
      '--json',
      'number,title,state',
    ]),
  );
  const issue = issues.filter((entry) => entry.title === title).sort((a, b) => a.number - b.number)[0];
  const output = Buffer.from(stripVTControlCharacters(log)).subarray(-45_000).toString('utf8').replaceAll('~~~', '---');
  const body = `Restore drill failed: ${runUrl}\n\nThe workflow artifact contains the full receipt.\n\n~~~text\n${output}\n~~~\n`;
  if (issue) {
    if (issue.state === 'CLOSED') gh(['issue', 'reopen', String(issue.number), '--repo', repository]);
    gh(['issue', 'comment', String(issue.number), '--repo', repository, '--body-file', '-'], body);
  } else {
    gh(['issue', 'create', '--repo', repository, '--title', title, '--body-file', '-'], body);
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.env.RESTORE_DRILL_LOG;
  reportRestoreFailure({
    repository: process.env.GITHUB_REPOSITORY,
    runUrl: process.env.RESTORE_DRILL_RUN_URL,
    log: path && existsSync(path) ? readFileSync(path, 'utf8') : 'No drill log was produced. Inspect the setup steps in the linked run.',
  });
}
