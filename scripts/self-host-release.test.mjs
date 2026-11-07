import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { linksToLatestRelease, markdownLinkTargets } from './self-host-release.mjs';

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
