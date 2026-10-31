import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const conventional = /^(build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test|wip)(\([\w./-]+\))?!?: .+/;

// Non-human policy: GitHub Bot accounts, [bot] markers, known automation
// addresses, all @openai.com addresses, and these AI noreply addresses.
const excludedEmail =
  /@openai\.com$|^noreply@(?:anthropic\.com|cursor\.com|githubcopilot\.com)$|^(?:dependabot|github-actions)@(?:users\.noreply\.github\.com|github\.com)$/i;

export function isPerson({ name = '', email = '', login = '', type }) {
  return type !== 'Bot' && !/\[bot\]/i.test(`${name} ${email} ${login}`) && !excludedEmail.test(email);
}

export function highlights(markdown, version, dry, warn = console.error) {
  const sections = [...markdown.matchAll(/^## (.+)\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
  const versionSection = sections.find((m) => m[1].replace(/^\[|\]$/g, '') === version);
  const section = versionSection ?? (dry ? sections.find((m) => m[1] === 'Unreleased') : undefined);
  if (section && !versionSection)
    warn(
      `Warning: ## ${version} is missing; using ## Unreleased for this dry run only. Before tagging, rename the section to ## ${version} and rerun the preview. Publishing will fail until that version section exists.`,
    );
  const text = section?.[2].match(/^### Highlights\s*\r?\n([\s\S]*?)(?=^### |$(?![\s\S]))/m)?.[1].trim();
  if (!text || text.includes('<!--'))
    throw new Error(
      `Add 1–3 user-facing sentences under ### Highlights in CHANGELOG.md section ## ${version}${dry ? ' (or ## Unreleased for a dry run)' : ''}. Highlights must not be empty or contain HTML comments.`,
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

export function summarize(commits, previous, logins, accountTypes = new Map()) {
  const identity = (person) => {
    const login = logins.get(person.email.toLowerCase());
    return { ...person, login, type: accountTypes.get(login), key: login?.toLowerCase() ?? person.email.toLowerCase() };
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
  for (const commit of commits) {
    for (const person of commit.people.map(identity).filter(isPerson)) people.set(person.key, person);
  }
  return {
    changes: changes.length,
    contributors: [...people.values()]
      .map((p) => ({ label: p.login ? `@${p.login}` : p.name.replace(/[@<>[\]*_`]/g, ''), first: !old.has(p.key) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

export function compose({ version, from, to, repo, intro, commits, summary, generated }) {
  const fixes = [
    ...new Set(
      commits
        .filter((c) => /^fix(?:\([\w./-]+\))?!?: /.test(c.subject) && /#\d+/.test(c.subject))
        .map(
          (c) =>
            `- ${c.subject
              .replace(/^fix(?:\([\w./-]+\))?!?: /, '')
              .replaceAll('&', '&amp;')
              .replaceAll('<', '&lt;')
              .replaceAll('>', '&gt;')}`,
        ),
    ),
  ];
  // The engine adds its own compare footer; the unified layout owns that link.
  const changelog = generated.replace(/^##### .*\[View changes on GitHub\].*$/gm, '').trim();
  return `${[
    `**${version}** · ${summary.changes} changes from ${summary.contributors.length} contributor${summary.contributors.length === 1 ? '' : 's'}`,
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

export function previousTag(toOid, prerelease, gitCommand = git) {
  return gitCommand('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', ...(prerelease ? [] : ['--exclude', 'v*-*']), `${toOid}^`);
}

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
  const accountTypes = new Map();
  for (const login of new Set(logins.values())) {
    const account = JSON.parse(run('gh', ['api', `users/${login}`]));
    if (!account.type) throw new Error(`Missing GitHub account type for ${login}`);
    accountTypes.set(login, account.type);
  }
  return { logins, accountTypes };
}

export function publishRelease({ repo, version, file, prerelease, dry = false }, gh = (...args) => run('gh', args)) {
  // List succeeds (including an empty result) or fails closed on auth/network errors.
  const releases = JSON.parse(gh('api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`)).flat();
  if (dry) return 'Dry run: release lookup succeeded; no release was created or edited.';
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
  const prerelease = /^v\d+\.\d+\.\d+-/.test(version);
  const toOid = git('rev-parse', '--verify', `${to}^{commit}`);
  const from = values.from ?? previousTag(toOid, prerelease);
  const fromOid = git('rev-parse', '--verify', `${from}^{commit}`);
  console.error(`Release notes range: ${from} (${fromOid})..${to} (${toOid})`);
  const repo = git('remote', 'get-url', 'origin')
    .replace(/^.*github.com[:/]/, '')
    .replace(/\.git$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Origin must be a GitHub repository.');
  const intro = highlights(readFileSync('CHANGELOG.md', 'utf8'), version, values.dry);
  const readLog = (range) => parseLog(run('git', ['log', '--format=%H%x1f%an%x1f%ae%x1f%B%x1e', range]));
  const commits = readLog(`${fromOid}..${toOid}`);
  const previous = readLog(fromOid);
  for (const c of commits) if (!conventional.test(c.subject)) console.error(`Warning: non-conventional commit ${c.sha.slice(0, 7)}: ${c.subject}`);
  const { logins, accountTypes } = resolveLogins([...commits, ...previous], repo);
  const summary = summarize(commits, previous, logins, accountTypes);
  const temp = mkdtempSync(join(tmpdir(), 'release-notes-'));
  try {
    const raw = join(temp, 'changelog.md');
    // --output returns before changelogithub's publishing path; --dry would skip writing the file.
    const pnpmPath = process.env.npm_execpath;
    if (!pnpmPath) throw new Error('Run this command through pnpm release:notes or pnpm release:notes:dry.');
    const args = ['release:notes:engine', '--from', fromOid, '--to', toOid, '--output', raw];
    if (/\.(?:c?js|mjs)$/.test(pnpmPath)) run(process.execPath, [pnpmPath, ...args]);
    else run(pnpmPath, args);
    const body = compose({ version, from, to, repo, intro, commits, summary, generated: readFileSync(raw, 'utf8') });
    if (values.output) writeFileSync(values.output, body);
    process.stdout.write(body);
    const file = join(temp, 'notes.md');
    writeFileSync(file, body);
    console.error(publishRelease({ repo, version, file, prerelease, dry: values.dry }));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
