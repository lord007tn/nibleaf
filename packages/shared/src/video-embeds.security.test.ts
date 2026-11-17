import { describe, expect, it } from 'vitest';
import { parseVideoUrl } from './video-embeds';

const VIDEO = 'https://www.youtube.com/watch?v=M7lc1UVf-VE';

describe('parseVideoUrl owns its input guard', () => {
  it('rejects controls, whitespace and backslashes without a caller guard', () => {
    const inputs = ['\t', '\n', '\r'].flatMap((character) =>
      [0, 8, 15, 27, VIDEO.length].map((position) => VIDEO.slice(0, position) + character + VIDEO.slice(position)),
    );
    inputs.push(
      ...Array.from({ length: 32 }, (_, code) => `${VIDEO}&extra=${String.fromCharCode(code)}`),
      'https:\\www.youtube.com\\watch?v=M7lc1UVf-VE',
      'https://www.youtube.com\\@evil.example/watch?v=M7lc1UVf-VE',
      `${VIDEO}&extra=a b`,
      `${VIDEO}&extra=\u00a0`,
      `${VIDEO}&extra=\u0000`,
      `${VIDEO}&extra=\u007f`,
    );
    expect(inputs.filter((input) => parseVideoUrl(input) !== null)).toEqual([]);
  });

  it('rejects encoded hosts, credentials and Unicode lookalikes even after URL normalization', () => {
    const inputs = [
      'https://www.you%09tube.com/watch?v=M7lc1UVf-VE',
      'https://www.you%0atube.com/watch?v=M7lc1UVf-VE',
      'https://www.you%0dtube.com/watch?v=M7lc1UVf-VE',
      'https://www.youtube.com@evil.example/watch?v=M7lc1UVf-VE',
      'https://user:pass@www.youtube.com/watch?v=M7lc1UVf-VE',
      'HTTPS://WWW.YOUTUBE.COM@EVIL.EXAMPLE/watch?v=M7lc1UVf-VE',
      'HTTPS://WWW.YOUTUBE.COM\\@EVIL.EXAMPLE/watch?v=M7lc1UVf-VE',
      'https://www.yоutube.com/watch?v=M7lc1UVf-VE', // Cyrillic o.
      'https://ｗｗｗ.youtube.com/watch?v=M7lc1UVf-VE', // URL maps fullwidth letters to ASCII.
      'https://www。youtube.com/watch?v=M7lc1UVf-VE', // URL maps the ideographic dot to ASCII.
      'https://www.xn--yutube-wqf.com/watch?v=M7lc1UVf-VE',
    ];
    expect(inputs.filter((input) => parseVideoUrl(input) !== null)).toEqual([]);
  });
});
