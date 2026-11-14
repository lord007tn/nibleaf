import { pageContentFacts } from '@nibleaf/shared/publish-checks';
import { readerEmbedSource, rewriteReaderEmbeds, scanAuthoredEmbeds } from '@nibleaf/shared/reader-embeds';
import { parseVideoUrl, type VideoEmbed, videoEmbedSrc } from '@nibleaf/shared/video-embeds';
import { expect, it } from 'vitest';
import { importEmbed, normalizeImportFidelity } from '../../../../../server/src/actions/importers/import-fidelity';
import { embedTargetFor, providerVideoOf } from './video-embed-url';

const YT = 'M7lc1UVf-VE';
const LOOM = '0123456789abcdef0123456789abcdef';
const bases: { url: string; video: VideoEmbed }[] = [
  ...[
    'www.youtube.com/watch?v=',
    'youtube.com/watch?v=',
    'm.youtube.com/watch?v=',
    'youtu.be/',
    'www.youtube.com/shorts/',
    'www.youtube.com/embed/',
    'youtube-nocookie.com/embed/',
    'www.youtube-nocookie.com/embed/',
  ].map((path) => ({
    url: `https://${path}${YT}`,
    video: { provider: 'youtube' as const, id: YT },
  })),
  ...['vimeo.com/', 'www.vimeo.com/', 'player.vimeo.com/video/'].map((path) => ({
    url: `https://${path}76979871`,
    video: { provider: 'vimeo' as const, id: '76979871' },
  })),
  ...['loom.com/share/', 'www.loom.com/share/', 'www.loom.com/embed/'].map((path) => ({
    url: `https://${path}${LOOM}`,
    video: { provider: 'loom' as const, id: LOOM },
  })),
  { url: 'https://acme.wistia.com/medias/abc123def4', video: { provider: 'wistia', id: 'abc123def4' } },
  { url: 'https://fast.wistia.net/embed/iframe/abc123def4', video: { provider: 'wistia', id: 'abc123def4' } },
];

const readerVideo = (url: string): VideoEmbed | null => {
  const source = readerEmbedSource(url);
  return source?.kind === 'video' ? source.video : null;
};
const editorVideo = (url: string): VideoEmbed | null => {
  const target = embedTargetFor(url, 'video');
  return target?.kind === 'iframe' ? providerVideoOf(target.src) : null;
};
const importerVideo = (url: string): VideoEmbed | null => {
  const output = importEmbed(url, 'Video', () => undefined);
  const frame = scanAuthoredEmbeds(output).find((embed) => embed.kind === 'iframe');
  return frame ? readerVideo(frame.attributes.get('src') ?? '') : null;
};

const longVideoUrl = (length: number): string => `https://www.youtube.com/watch?v=${YT}&t=90&x=`.padEnd(length, 'a');

it('preserves main answers at 2,048, 2,049 and 8,192 characters across every embed path', () => {
  const video: VideoEmbed = { provider: 'youtube', id: YT, start: 90 };
  const player = `<iframe src="${videoEmbedSrc(video)}" title="Video"></iframe>`;
  const rewritten = `<mdxembed provider="youtube" videoid="${YT}" start="90" title="Video"></mdxembed>`;
  const answers = [2048, 2049, 8192].map((length) => {
    const url = longVideoUrl(length);
    const frame = `<iframe src="${url.replaceAll('&', '&amp;')}" title="Video"></iframe>`;
    const code = `<code>Video: ${url.replaceAll('&', '&amp;')}</code>`;
    return {
      length,
      parser: parseVideoUrl(url),
      reader: readerVideo(url),
      preview: providerVideoOf(url),
      // The existing authored-tag scanner stops after 4,096 characters.
      rewriteMatchesMain: rewriteReaderEmbeds(frame) === (length < 4096 ? rewritten : frame),
      embedsAsLinks: pageContentFacts(frame, false).embedsAsLinks,
      importEmbedMatchesMain: importEmbed(url, 'Video', () => undefined) === (length === 2048 ? player : code),
      importStandaloneMatchesMain: normalizeImportFidelity(url) === (length === 2048 ? player : url),
      importAuthoredMatchesMain: normalizeImportFidelity(frame) === (length === 2048 ? player : length < 4096 ? code : frame),
    };
  });
  expect(answers).toEqual(
    [2048, 2049, 8192].map((length) => ({
      length,
      parser: length === 2048 ? video : null,
      reader: video,
      preview: video,
      rewriteMatchesMain: true,
      embedsAsLinks: [],
      importEmbedMatchesMain: true,
      importStandaloneMatchesMain: true,
      importAuthoredMatchesMain: true,
    })),
  );
});

it('validates hostile bytes beyond the clip while retaining long valid videos', () => {
  const valid = longVideoUrl(3500);
  for (const character of ['\n', '\t', '\r', ' ', '\\', '\u0000', '\u007f', '\u00a0']) {
    const url = valid.slice(0, 3000) + character + valid.slice(3000);
    const frame = `<iframe src="${url.replaceAll('&', '&amp;')}" title="Video"></iframe>`;
    expect(parseVideoUrl(url)).toBeNull();
    expect(readerVideo(url)).toBeNull();
    expect(providerVideoOf(url)).toBeNull();
    expect(rewriteReaderEmbeds(frame)).not.toContain('provider="youtube"');
    expect(pageContentFacts(frame, false).embedsAsLinks).toHaveLength(1);
    expect(importerVideo(url)).toBeNull();
    expect(normalizeImportFidelity(url)).not.toContain('youtube-nocookie.com/embed/');
    expect(normalizeImportFidelity(frame)).not.toContain('youtube-nocookie.com/embed/');
  }
  expect(readerVideo(valid)).toEqual({ provider: 'youtube', id: YT, start: 90 });
  expect(providerVideoOf(valid)).toEqual({ provider: 'youtube', id: YT, start: 90 });
});

// Intentional existing valid-input policies, outside the HTTPS differential:
// | Input                 | Shared parser | Reader | Editor | Importer |
// | http provider URL     | accepts       | accepts| rejects| rejects  |
// | //provider URL        | accepts       | accepts| rejects| rejects  |
// | space-padded HTTPS   | accepts       | accepts| accepts| rejects  |
// | HTTPS over 2,048     | rejects       | accepts| rejects| rejects  |
// Editor previews follow the reader's length policy; editor input does not.
// Contract unification is a separate follow-up; preserve these policies here.
it('agrees on provider/id across seeded variants and the long-URL policy corpus', () => {
  const video = { provider: 'youtube', id: YT };
  for (const [url, expected] of [
    [`http://www.youtube.com/watch?v=${YT}`, [video, video, null, null]],
    [`//www.youtube.com/watch?v=${YT}`, [video, video, null, null]],
    [`  https://www.youtube.com/watch?v=${YT}  `, [video, video, video, null]],
  ] as const) {
    expect([parseVideoUrl(url), readerVideo(url), editorVideo(url), importerVideo(url)]).toEqual(expected);
  }
  let seed = 580;
  const next = (limit: number): number => {
    seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
    return seed % limit;
  };
  const cases: { url: string; expected: VideoEmbed | null; readerExpected?: VideoEmbed }[] = [];
  for (const base of bases) {
    const parsed = new URL(base.url);
    for (let index = 0; index < 128; index++) {
      const input = `${base.url}${base.url.includes('?') ? '&' : '?'}case=${index}`;
      const authorityEnd = input.indexOf('/', 8);
      const position = 1 + next(input.length - 1);
      const insert = (value: string) => input.slice(0, position) + value + input.slice(position);
      const hostPosition = 8 + next(parsed.hostname.length);
      const hostInsert = (value: string) => input.slice(0, hostPosition) + value + input.slice(hostPosition);
      const variants = [
        input,
        input.replaceAll(parsed.hostname, parsed.hostname.toUpperCase()).replaceAll('https:', 'HTTPS:'),
        insert('\t'),
        insert('\n'),
        insert('\r'),
        insert(' '),
        insert('\\'),
        insert('\u0000'),
        insert('\u007f'),
        insert('\u00a0'),
        hostInsert('%09'),
        hostInsert('%0A'),
        hostInsert('%0D'),
        `https:\\${input.slice(8).replaceAll('/', '\\')}`,
        `${input.slice(0, authorityEnd)}\\@evil.example${input.slice(authorityEnd)}`,
        `${input.slice(0, authorityEnd)}@evil.example${input.slice(authorityEnd)}`,
        input.replaceAll(parsed.hostname, `${parsed.hostname}.evil.example`).replaceAll('https:', 'HTTPS:'),
        input.replaceAll(parsed.hostname, `user:pass@${parsed.hostname}`),
        input.replaceAll('.', '。'),
        input.replaceAll(parsed.hostname, parsed.hostname.replaceAll('o', 'о').replaceAll('a', 'а').replaceAll('e', 'е')),
        input.replaceAll(parsed.hostname, 'ｗｗｗ.youtube.com'),
        input.replaceAll(parsed.hostname, 'www.xn--yutube-wqf.com'),
      ];
      const variant = index % variants.length;
      cases.push({ url: variants[variant] ?? base.url, expected: variant < 2 ? base.video : null });
    }
  }
  // Keep the seeded corpus, then include boundary lengths with main's caller policies.
  for (const length of [2048, 2049, 8192]) {
    const expected: VideoEmbed = { provider: 'youtube', id: YT, start: 90 };
    cases.push({ url: longVideoUrl(length), expected: length === 2048 ? expected : null, readerExpected: expected });
  }
  const long = longVideoUrl(3500);
  for (const character of ['\n', '\t', '\r', ' ', '\\', '\u0000', '\u007f', '\u00a0']) {
    cases.push({ url: long.slice(0, 3000) + character + long.slice(3000), expected: null });
  }
  expect(cases).toHaveLength(2059);
  expect(new Set(cases.map(({ url }) => url)).size).toBe(1999);
  const failures: string[] = [];
  for (const [index, { url, expected, readerExpected = expected }] of cases.entries()) {
    const answers = [parseVideoUrl(url), readerVideo(url), providerVideoOf(url), editorVideo(url), importerVideo(url)];
    const expectedAnswers = [expected, readerExpected, readerExpected, expected, expected];
    if (answers.some((answer, caller) => JSON.stringify(answer) !== JSON.stringify(expectedAnswers[caller])))
      failures.push(`${index}: ${JSON.stringify(url)}`);
  }
  expect(failures.length, failures.slice(0, 10).join('\n')).toBe(0);
});
