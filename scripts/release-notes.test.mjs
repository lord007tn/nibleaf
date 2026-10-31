import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { compose, conventional, highlights, parseLog, publishRelease, summarize } from './release-notes.mjs';

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
  assert.equal(highlights(md, 'v0.2.0', true), 'Reviewed.');
  assert.equal(highlights(md, 'v0.3.0', true), 'Preview.');
  assert.throws(() => highlights(md, 'v0.3.0', false), /Add 1–3.*### Highlights.*## v0.3.0/);
  assert.throws(() => highlights('## Unreleased\n\n### Highlights\n\n<!-- TODO -->\n', 'v0.2.0', true), /Highlights must not be empty/);
  assert.throws(() => highlights('## Unreleased\n\n### Highlights\n\n<!-- outer <!-- nested --> -->\n', 'v0.2.0', true), /Add 1/);
});

test('layout has optional fix-only lines, compare last inside a closed fold, contributors after fold', () => {
  const args = {
    version: 'v0.2.0',
    from: 'v0.1.2',
    to: 'origin/main',
    repo: 'lord007tn/nibleaf',
    intro: 'Read pages faster.',
    commits: [commit('Alice', 'a@x'), commit('Alice', 'a@x', 'feat: editor (#43)')],
    summary: { changes: 2, contributors: [{ label: '@alice', first: true }] },
    generated: '### Features\n\n- Editor\n\n##### &nbsp;[View changes on GitHub](url)',
  };
  const body = compose(args);
  assert.match(body, /^\*\*v0.2.0\*\* · 2 changes from 1 contributors\n\n## Highlights/);
  assert.match(body, /## Fixes\n\n- reader navigation \(#42\)/);
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
    else assert.deepEqual(calls[1].slice(0, 2), ['release', existing.length ? 'edit' : 'create']);
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
