import { readerEmbedSource, scanAuthoredEmbeds } from '@nibleaf/shared/reader-embeds';
import { parseVideoUrl, type VideoEmbed } from '@nibleaf/shared/video-embeds';
import { expect, it } from 'vitest';
import { importEmbed } from '../../../../../server/src/actions/importers/import-fidelity';
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

// Intentional existing valid-input policies, outside the HTTPS differential:
// | Input                 | Shared parser | Reader | Editor | Importer |
// | http provider URL     | accepts       | accepts| rejects| rejects  |
// | //provider URL        | accepts       | accepts| rejects| rejects  |
// | space-padded HTTPS   | accepts       | accepts| accepts| rejects  |
// Contract unification is a separate follow-up; preserve these policies here.
it('agrees on provider/id and rejects hostile inputs across 2,048 seeded variants', () => {
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
  const cases: { url: string; expected: VideoEmbed | null }[] = [];
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
  expect(cases).toHaveLength(2048);
  expect(new Set(cases.map(({ url }) => url)).size).toBe(1988);
  const failures: string[] = [];
  for (const [index, { url, expected }] of cases.entries()) {
    const answers = [parseVideoUrl(url), readerVideo(url), providerVideoOf(url), editorVideo(url), importerVideo(url)];
    if (answers.some((answer) => JSON.stringify(answer) !== JSON.stringify(expected))) failures.push(`${index}: ${JSON.stringify(url)}`);
  }
  expect(failures.length, failures.slice(0, 10).join('\n')).toBe(0);
});
