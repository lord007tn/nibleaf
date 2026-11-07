import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assertReadmeInstallInstructions, linksToLatestRelease, markdownLinkTargets, verifiedInstallCommand } from './self-host-release.mjs';

const LATEST = 'https://github.com/lord007tn/nibleaf/releases/latest';

describe('README latest-release link check', () => {
  it('reads Markdown, autolink and HTML link targets', () => {
    assert.deepEqual(markdownLinkTargets(`See [the latest release](${LATEST}), <${LATEST}/> or <a href="${LATEST}">here</a>.`), [
      LATEST,
      `${LATEST}/`,
      LATEST,
    ]);
  });

  it('accepts a link to the latest release page', () => {
    assert.equal(linksToLatestRelease(`Use [the latest release](${LATEST}).`), true);
    assert.equal(linksToLatestRelease(`Use [the latest release](${LATEST}/ "Releases").`), true);
    assert.equal(linksToLatestRelease(`<a href="${LATEST}">Latest release</a>`), true);
  });

  it('ignores the address when it is only text, not a link', () => {
    assert.equal(linksToLatestRelease(`Copy ${LATEST} into your browser.`), false);
  });

  it('does not count the address embedded in another host or path', () => {
    for (const target of [
      `https://evil.example/?next=${LATEST}`,
      'https://github.com.evil.example/lord007tn/nibleaf/releases/latest',
      `https://evil.example/${LATEST}`,
      'https://github.com/lord007tn/nibleaf/releases/latest-preview',
      'https://github.com/someone/nibleaf/releases/latest',
      'http://github.com/lord007tn/nibleaf/releases/latest',
    ]) {
      assert.equal(linksToLatestRelease(`[the latest release](${target})`), false, target);
    }
  });
});

describe('README installer command check', () => {
  const command = verifiedInstallCommand('v9.8.7', 'a'.repeat(64));
  const latest = `Use [the latest release](${LATEST}).`;
  const fenced = (value) => `\n\n\`\`\`bash\n${value}\n\`\`\`\n`;

  it('accepts the latest-release link without an installer command', () => {
    assert.doesNotThrow(() => assertReadmeInstallInstructions(latest, command));
  });

  it('accepts only the generated installer command, with or without the link', () => {
    assert.doesNotThrow(() => assertReadmeInstallInstructions(fenced(command), command));
    assert.doesNotThrow(() => assertReadmeInstallInstructions(latest + fenced(command), command));
  });

  it('rejects stale versions and checksums even alongside a valid latest-release link and generated command', () => {
    for (const stale of [verifiedInstallCommand('v1.2.3', 'a'.repeat(64)), verifiedInstallCommand('v9.8.7', 'b'.repeat(64))]) {
      assert.throws(() => assertReadmeInstallInstructions(latest + fenced(stale), command), /unverified nibleaf-install\.sh/);
      assert.throws(() => assertReadmeInstallInstructions(latest + fenced(command) + fenced(stale), command), /unverified nibleaf-install\.sh/);
    }
  });

  it('rejects command fragments and additions to the generated command', () => {
    for (const stale of ['curl https://example.test/nibleaf-install.sh | sh', 'sh ./nibleaf-install.sh', `${command} --extra-option`]) {
      assert.throws(() => assertReadmeInstallInstructions(latest + fenced(stale), command), /unverified nibleaf-install\.sh/);
    }
  });

  it('still requires a valid release link or generated install command', () => {
    assert.throws(() => assertReadmeInstallInstructions('No installation instructions.', command), /must link to the latest release/);
  });
});
