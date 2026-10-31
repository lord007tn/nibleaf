import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const conventional = /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test|wip)(\([\w./-]+\))?!?: .+/;

export function isPerson({ name = '', email = '', login = '' }) {
  return !/\[bot\]|\bbot\b|dependabot|github-actions|copilot|\bclaude\b|\bcodex\b|\bgpt\b|anthropic|openai/i.test(`${name} ${email} ${login}`);
}

export function highlights(markdown, version, dry) {
  const sections = [...markdown.matchAll(/^## (.+)\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
  const section = sections.find((m) => m[1].replace(/^\[|\]$/g, '') === version) ?? (dry ? sections.find((m) => m[1] === 'Unreleased') : undefined);
  const text = section?.[2]
    .match(/^### Highlights\s*\r?\n([\s\S]*?)(?=^### |$(?![\s\S]))/m)?.[1]
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim();
  if (!text)
    throw new Error(
      `Add 1–3 user-facing sentences under ### Highlights in CHANGELOG.md section ## ${version}${dry ? ' (or ## Unreleased for a dry run)' : ''}. Highlights must not be empty.`,
    );
  return text;
}

export function parseLog(log) {
  return log
    .split('\x1e')
    .filter((s) => s.trim())
    .map((record) => {
      const [sha, name, email, ...body] = record.trim().split('\x1f');
      const message = body.join('\x1f').trim();
      const people = [{ name, email }];
      for (const match of message.matchAll(/^Co-authored-by:\s*(.+?)\s*<([^>]+)>\s*$/gim)) people.push({ name: match[1], email: match[2] });
      return { sha, subject: message.split('\n')[0], people };
    });
}

export function summarize(commits, previous, logins) {
  const identity = (person) => {
    const login = logins.get(person.email.toLowerCase());
    return { ...person, login, key: login?.toLowerCase() ?? person.email.toLowerCase() };
  };
  const old = new Set(
    previous.flatMap((c) =>
      c.people
        .map(identity)
        .filter(isPerson)
        .map((p) => p.key),
    ),
  );
  const people = new Map();
  const changes = commits.filter((c) => isPerson(identity(c.people[0])));
  for (const commit of changes) {
    for (const person of commit.people.map(identity).filter(isPerson)) people.set(person.key, person);
  }
  return {
    changes: changes.length,
    contributors: [...people.values()]
      .map((p) => ({ label: p.login ? `@${p.login}` : p.name.replace(/[<>[\]*_`]/g, ''), first: !old.has(p.key) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

export function compose({ version, from, to, repo, intro, commits, summary, generated }) {
  const fixes = commits
    .filter((c) => /^fix(?:\([\w./-]+\))?!?: /.test(c.subject) && /#\d+/.test(c.subject))
    .map((c) => `- ${c.subject.replace(/^fix(?:\([\w./-]+\))?!?: /, '')}`);
  // The engine adds its own compare footer; the unified layout owns that link.
  const changelog = generated.replace(/^##### .*\[View changes on GitHub\].*$/gm, '').trim();
  return `${[
    `**${version}** · ${summary.changes} changes from ${summary.contributors.length} contributors`,
    '## Highlights',
    intro,
    ...(fixes.length ? ['## Fixes', fixes.join('\n')] : []),
    `<details><summary>Full changelog</summary>\n\n${changelog}\n\n**Full Changelog**: https://github.com/${repo}/compare/${from}...${to}\n\n</details>`,
    '## Contributors',
    summary.contributors.map((p) => `- ${p.label}${p.first ? ' (first-time contributor)' : ''}`).join('\n') || 'No human contributors in this range.',
  ].join('\n\n')}\n`;
}

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const git = (...args) => run('git', args).trim();

function resolveLogins(commits, repo) {
  const logins = new Map();
  const [owner, name] = repo.split('/');
  for (let offset = 0; offset < commits.length; offset += 30) {
    const batch = commits.slice(offset, offset + 30);
    const objects = batch
      .map(
        (c, i) =>
          `c${i}: object(oid: "${c.sha}") { ... on Commit { authors(first: 100) { nodes { email user { login } } pageInfo { hasNextPage } } } }`,
      )
      .join('\n');
    const result = JSON.parse(run('gh', ['api', 'graphql', '-f', `query=query { repository(owner: "${owner}", name: "${name}") { ${objects} } }`]));
    if (result.errors) throw new Error('GitHub identity resolution failed');
    for (const commit of Object.values(result.data.repository)) {
      if (!commit?.authors || commit.authors.pageInfo.hasNextPage) throw new Error('Incomplete GitHub author resolution');
      for (const author of commit.authors.nodes) if (author.user) logins.set(author.email.toLowerCase(), author.user.login);
    }
  }
  return logins;
}

export function publishRelease({ repo, version, file, prerelease }, gh = (...args) => run('gh', args)) {
  // List succeeds (including an empty result) or fails closed on auth/network errors.
  const releases = JSON.parse(gh('api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`)).flat();
  const existing = releases.find((r) => r.tag_name === version);
  if (existing && !existing.draft) return 'Published release already exists; preserving its title and notes.';
  const common = [version, '--repo', repo, '--title', `Nibleaf ${version}`, '--notes-file', file];
  if (existing) gh('release', 'edit', ...common, '--draft=false', `--prerelease=${prerelease}`);
  else gh('release', 'create', ...common, '--verify-tag', ...(prerelease ? ['--prerelease'] : []));
  return `Published Nibleaf ${version}`;
}

function main() {
  const { values } = parseArgs({
    options: { from: { type: 'string' }, to: { type: 'string' }, version: { type: 'string' }, dry: { type: 'boolean' }, output: { type: 'string' } },
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
  });
  const to = values.to ?? process.env.GITHUB_REF_NAME ?? 'HEAD';
  const version = values.version ?? to;
  if (!/^v\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(version)) throw new Error('Use --version vX.Y.Z when --to is a branch or SHA.');
  if (!values.dry && to !== version) throw new Error('Publishing requires --to to equal the version tag.');
  const from = values.from ?? git('describe', '--tags', '--abbrev=0', `${to}^`);
  const repo = git('remote', 'get-url', 'origin')
    .replace(/^.*github.com[:/]/, '')
    .replace(/\.git$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Origin must be a GitHub repository.');
  const intro = highlights(readFileSync('CHANGELOG.md', 'utf8'), version, values.dry);
  const readLog = (range) => parseLog(run('git', ['log', '--format=%H%x1f%an%x1f%ae%x1f%B%x1e', range]));
  const commits = readLog(`${from}..${to}`);
  const previous = readLog(from);
  for (const c of commits) if (!conventional.test(c.subject)) console.error(`Warning: non-conventional commit ${c.sha.slice(0, 7)}: ${c.subject}`);
  const summary = summarize(commits, previous, resolveLogins([...commits, ...previous], repo));
  const temp = mkdtempSync(join(tmpdir(), 'release-notes-'));
  try {
    const raw = join(temp, 'changelog.md');
    // --output returns before changelogithub's publishing path; --dry would skip writing the file.
    const pnpmPath = process.env.npm_execpath;
    if (!pnpmPath) throw new Error('Run this command through pnpm release:notes or pnpm release:notes:dry.');
    const args = ['release:notes:engine', '--from', from, '--to', to, '--output', raw];
    if (/\.(?:c?js|mjs)$/.test(pnpmPath)) run(process.execPath, [pnpmPath, ...args]);
    else run(pnpmPath, args);
    const body = compose({ version, from, to, repo, intro, commits, summary, generated: readFileSync(raw, 'utf8') });
    if (values.output) writeFileSync(values.output, body);
    process.stdout.write(body);
    if (!values.dry) {
      const file = join(temp, 'notes.md');
      writeFileSync(file, body);
      console.error(publishRelease({ repo, version, file, prerelease: /^v\d+\.\d+\.\d+-/.test(version) }));
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
