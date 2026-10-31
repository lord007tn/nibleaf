import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { compose, conventional, highlights, isPerson, parseLog, previousTag, publishRelease, summarize } from './release-notes.mjs';

const commit = (name, email, subject = 'fix: reader navigation (#42)', people = []) => ({ subject, people: [{ name, email }, ...people] });

test('counts humans, mixed-case co-authors, GitHub aliases and first-time people; excludes bots and AI', () => {
  const parsed = parseLog(
    'abc\x1fAlice\x1fa@x\x1ffeat: portable notes\n\nCo-Authored-By: Bob <b@x>\nCo-authored-by: Claude <noreply@anthropic.com>\x1e',
  );
  assert.equal(parsed[0].people.length, 3);
  const summary = summarize(
    [
      ...parsed,
      commit('Alice', 'alias@x'),
      commit('dependabot[bot]', 'bot@x'),
      commit('Alice', 'a@x', 'chore: cleanup', [{ name: 'GPT-6.1 Sol', email: 'noreply@openai.com' }]),
    ],
    [commit('Alice', 'old@x')],
    new Map([
      ['a@x', 'alice'],
      ['alias@x', 'alice'],
      ['old@x', 'alice'],
      ['b@x', 'bob'],
    ]),
  );
  assert.deepEqual(summary, {
    changes: 3,
    contributors: [
      { label: '@alice', first: false },
      { label: '@bob', first: true },
    ],
  });
});

test('version highlights take precedence; only dry runs fall back; empty highlights fail helpfully', () => {
  const md = '## Unreleased\n\n### Highlights\n\nPreview.\n\n## v0.2.0\n\n### Highlights\n\nReviewed.\n\n### Fixes\nOther.';
  const warnings = [];
  assert.equal(
    highlights(md, 'v0.2.0', true, (message) => warnings.push(message)),
    'Reviewed.',
  );
  assert.deepEqual(warnings, []);
  assert.equal(
    highlights(md, 'v0.3.0', true, (message) => warnings.push(message)),
    'Preview.',
  );
  assert.match(warnings[0], /Warning: ## v0.3.0 is missing; using ## Unreleased.*Before tagging.*Publishing will fail/);
  assert.throws(() => highlights('## v0.2.0\n\n### Highlights\n\n', 'v0.2.0', false), /Highlights must not be empty/);
  assert.throws(() => highlights(md, 'v0.3.0', false), /Add 1–3.*### Highlights.*## v0.3.0/);
  assert.throws(
    () => highlights('## v0.2.0\n\n### Highlights\n\nReal text.\n\n<!-- note -->\n', 'v0.2.0', false),
    /must not be empty or contain HTML comments/,
  );
  assert.throws(
    () => highlights('## Unreleased\n\n### Highlights\n\n<!-- TODO -->\n', 'v0.2.0', true, (message) => warnings.push(message)),
    /Highlights must not be empty/,
  );
  assert.throws(
    () => highlights('## Unreleased\n\n### Highlights\n\n<!-- outer <!-- nested --> -->\n', 'v0.2.0', true, (message) => warnings.push(message)),
    /Add 1/,
  );
});

test('layout has optional fix-only lines, compare last inside a closed fold, contributors after fold', () => {
  const args = {
    version: 'v0.2.0',
    from: 'v0.1.2',
    to: 'origin/main',
    repo: 'lord007tn/nibleaf',
    intro: 'Read pages faster.',
    commits: [
      commit('Alice', 'a@x'),
      commit('Alice', 'a@x'),
      commit('Alice', 'a@x', 'fix: escape <details> & </details> (#44)'),
      commit('Alice', 'a@x', 'feat: editor (#43)'),
    ],
    summary: { changes: 2, contributors: [{ label: '@alice', first: true }] },
    generated: '### Features\n\n- Editor\n\n##### &nbsp;[View changes on GitHub](url)',
  };
  const body = compose(args);
  assert.match(body, /^\*\*v0.2.0\*\* · 2 changes from 1 contributor\n\n## Highlights/);
  assert.match(body, /## Fixes\n\n- reader navigation \(#42\)/);
  assert.equal(body.match(/reader navigation/g).length, 1);
  assert.match(body, /escape &lt;details&gt; &amp; &lt;\/details&gt; \(#44\)/);
  assert.equal(body.match(/<details>/g)?.length ?? 0, 1);
  assert.match(body, /<details><summary>Full changelog<\/summary>\n\n### Features/);
  assert.doesNotMatch(body, /<details[^>]*open|View changes on GitHub/);
  assert.match(body, /\*\*Full Changelog\*\*: .*v0.1.2\.\.\.origin\/main\n\n<\/details>\n\n## Contributors\n\n- @alice \(first-time contributor\)/);
  assert.doesNotMatch(compose({ ...args, commits: [] }), /## Fixes/);
});

test('PR title workflow uses Naasher convention and rejects non-conventional titles', () => {
  const workflow = readFileSync('.github/workflows/pr-title-lint.yml', 'utf8');
  const pattern = workflow.match(/const pattern = (\/.*\/);/)[1];
  const regex = new RegExp(pattern.slice(1, -1));
  for (const title of ['feat(release): compose notes', 'chore(deps): bump dependencies']) assert.ok(regex.test(title));
  assert.equal(regex.test('Update release notes'), false);
  assert.equal(conventional.test('Merge pull request #42'), false);
});

test('published releases remain immutable; drafts complete and missing releases are created', () => {
  const opts = { repo: 'lord007tn/nibleaf', version: 'v0.2.0', file: 'notes.md', prerelease: false };
  for (const existing of [[], [{ tag_name: 'v0.2.0', draft: true }], [{ tag_name: 'v0.2.0', draft: false }]]) {
    const calls = [];
    publishRelease(opts, (...args) => {
      calls.push(args);
      return JSON.stringify([existing]);
    });
    if (existing[0]?.draft === false) assert.equal(calls.length, 1);
    else {
      assert.deepEqual(calls[1], [
        'release',
        existing.length ? 'edit' : 'create',
        'v0.2.0',
        '--repo',
        'lord007tn/nibleaf',
        '--title',
        'Nibleaf v0.2.0',
        '--notes-file',
        'notes.md',
        ...(existing.length ? ['--draft=false', '--prerelease=false'] : ['--verify-tag']),
      ]);
    }
    assert.deepEqual(calls[0], ['api', '--paginate', '--slurp', 'repos/lord007tn/nibleaf/releases?per_page=100']);
  }
  assert.throws(
    () =>
      publishRelease(opts, () => {
        throw new Error('network');
      }),
    /network/,
  );
});

test('Zhincore squash co-authors share the login resolved by #237; Anthropic trailer variants never count', () => {
  const commits = [
    commit('Raed', 'raed@example.test', 'feat: editor (#1)', [
      { name: 'Adam', email: 'adam@zhincore.eu' },
      { name: 'Claude Opus 5.5 (1M context)', email: 'noreply@anthropic.com' },
      { name: 'Different AI trailer name', email: 'NOREPLY@ANTHROPIC.COM' },
    ]),
    commit('Adam', 'adam@zhincore.eu', 'fix: navigate published sites without full page reloads (#237)'),
    commit('Adam', 'alias@example.test', 'feat: another contribution (#2)'),
  ];
  const summary = summarize(
    commits,
    [],
    new Map([
      ['raed@example.test', 'lord007tn'],
      ['adam@zhincore.eu', 'Zhincore'],
      ['alias@example.test', 'Zhincore'],
    ]),
  );
  assert.deepEqual(summary, {
    changes: 3,
    contributors: [
      { label: '@lord007tn', first: true },
      { label: '@Zhincore', first: true },
    ],
  });
});

test('human co-authors on bot commits receive credit without counting the bot commit', () => {
  const summary = summarize(
    [commit('dependabot[bot]', 'bot@example.test', 'chore(deps): update (#3)', [{ name: 'Human contributor', email: 'human@example.test' }])],
    [],
    new Map([['human@example.test', 'human-contributor']]),
  );
  assert.deepEqual(summary, { changes: 0, contributors: [{ label: '@human-contributor', first: true }] });
});

test('previous tag skips release candidates for finals and includes them for candidates', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nibleaf-tag-test-'));
  assert.ok(resolve(directory).startsWith(`${resolve(tmpdir())}\\`) || resolve(directory).startsWith(`${resolve(tmpdir())}/`));
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    git('init');
    const checkpoint = (tag) => {
      git(
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.test',
        '-c',
        'commit.gpgsign=false',
        'commit',
        '--allow-empty',
        '-m',
        `feat: ${tag}`,
      );
      git('tag', tag);
    };
    checkpoint('v0.1.2');
    checkpoint('v0.2.0-rc.1');
    checkpoint('v0.2.0-rc.2');
    git('tag', 'deploy-latest');
    checkpoint('v0.2.0');
    assert.equal(previousTag('v0.2.0', false, git), 'v0.1.2');
    assert.equal(previousTag('v0.2.0-rc.2', true, git), 'v0.2.0-rc.1');
    assert.equal(previousTag('v0.2.0-rc.1', true, git), 'v0.1.2');
    git('remote', 'add', 'origin', 'https://github.com/lord007tn/nibleaf.git');
    writeFileSync(join(directory, 'CHANGELOG.md'), '## Unreleased\n\n### Highlights\n\n');
    const cli = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('./release-notes.mjs', import.meta.url)), '--dry', '--from', 'v0.1.2', '--to', 'v0.2.0', '--version', 'v0.3.0'],
      { cwd: directory, encoding: 'utf8' },
    );
    assert.equal(cli.status, 1);
    assert.match(cli.stderr, /using ## Unreleased.*Before tagging/);
    assert.match(cli.stderr, /Highlights must not be empty/);
    assert.equal(cli.stdout, '');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('humans named Claude or Bot stay credited; automation accounts and AI addresses do not', () => {
  for (const name of ['Claude', 'Bot Human', 'Codex Smith']) assert.equal(isPerson({ name, email: 'person@example.test', type: 'User' }), true);
  assert.equal(isPerson({ name: 'Service', email: 'service@example.test', type: 'Bot' }), false);
  for (const email of [
    'noreply@anthropic.com',
    'agent@openai.com',
    'noreply@cursor.com',
    'noreply@githubcopilot.com',
    'dependabot@users.noreply.github.com',
  ])
    assert.equal(isPerson({ email }), false);
  const summary = summarize(
    [commit('Claude Bot', 'human@example.test'), commit('Service', 'service@example.test')],
    [],
    new Map([['service@example.test', 'service-account']]),
    new Map([['service-account', 'Bot']]),
  );
  assert.deepEqual(summary, { changes: 1, contributors: [{ label: 'Claude Bot', first: true }] });
  assert.equal(summarize([commit('@someone', 'unresolved@example.test')], [], new Map()).contributors[0].label, 'someone');
});

test('prereleases carry their title, verification and prerelease flags; dry lookup never mutates', () => {
  const opts = { repo: 'lord007tn/nibleaf', version: 'v0.2.0-rc.1', file: 'notes.md', prerelease: true };
  for (const existing of [[], [{ tag_name: opts.version, draft: true }]]) {
    const calls = [];
    publishRelease(opts, (...args) => {
      calls.push(args);
      return JSON.stringify([existing]);
    });
    assert.deepEqual(calls[1], [
      'release',
      existing.length ? 'edit' : 'create',
      opts.version,
      '--repo',
      opts.repo,
      '--title',
      'Nibleaf v0.2.0-rc.1',
      '--notes-file',
      opts.file,
      ...(existing.length ? ['--draft=false', '--prerelease=true'] : ['--verify-tag', '--prerelease']),
    ]);
  }
  const calls = [];
  assert.match(
    publishRelease({ ...opts, dry: true }, (...args) => {
      calls.push(args);
      return '[[]]';
    }),
    /no release was created or edited/,
  );
  assert.equal(calls.length, 1);
});
