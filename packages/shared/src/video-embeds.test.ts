import { describe, expect, it } from 'vitest';
import {
  isAllowedMediaUrl,
  parseVideoStart,
  parseVideoUrl,
  parseWebUrl,
  VIDEO_EMBED_ORIGINS,
  videoEmbedFrom,
  videoEmbedSrc,
  videoPageUrl,
} from './video-embeds';

const YT = 'dQw4w9WgXcQ';
const LOOM = '0123456789abcdef0123456789abcdef';

describe('parseVideoUrl accepts each provider form', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${YT}`, { provider: 'youtube', id: YT }],
    [`https://youtube.com/watch?v=${YT}&list=PL1&si=abc`, { provider: 'youtube', id: YT }],
    [`https://m.youtube.com/watch?v=${YT}`, { provider: 'youtube', id: YT }],
    [`http://www.youtube.com/watch?v=${YT}`, { provider: 'youtube', id: YT }],
    [`https://youtu.be/${YT}`, { provider: 'youtube', id: YT }],
    [`https://youtu.be/${YT}?si=share`, { provider: 'youtube', id: YT }],
    [`https://www.youtube.com/shorts/${YT}`, { provider: 'youtube', id: YT }],
    [`https://www.youtube.com/embed/${YT}`, { provider: 'youtube', id: YT }],
    [`https://www.youtube.com/embed/${YT}/`, { provider: 'youtube', id: YT }],
    [`https://www.youtube-nocookie.com/embed/${YT}`, { provider: 'youtube', id: YT }],
    [`//www.youtube.com/embed/${YT}`, { provider: 'youtube', id: YT }],
    [`  https://WWW.YOUTUBE.COM/embed/${YT}  `, { provider: 'youtube', id: YT }],
    ['https://vimeo.com/76979871', { provider: 'vimeo', id: '76979871' }],
    ['https://www.vimeo.com/76979871', { provider: 'vimeo', id: '76979871' }],
    ['https://player.vimeo.com/video/76979871?h=abc&badge=0', { provider: 'vimeo', id: '76979871' }],
    [`https://www.loom.com/share/${LOOM}`, { provider: 'loom', id: LOOM }],
    [`https://loom.com/share/${LOOM}?sid=1`, { provider: 'loom', id: LOOM }],
    [`https://www.loom.com/embed/${LOOM}`, { provider: 'loom', id: LOOM }],
    ['https://acme.wistia.com/medias/abc123def4', { provider: 'wistia', id: 'abc123def4' }],
    ['https://fast.wistia.net/embed/iframe/abc123def4?videoFoam=true', { provider: 'wistia', id: 'abc123def4' }],
  ])('%s', (input, expected) => {
    expect(parseVideoUrl(input)).toEqual(expected);
  });
});

describe('parseVideoUrl keeps a start time as whole seconds and drops the rest', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${YT}&t=90`, 90],
    [`https://www.youtube.com/watch?v=${YT}&t=90s`, 90],
    [`https://youtu.be/${YT}?t=1m30s`, 90],
    [`https://youtu.be/${YT}?t=1h2m3s`, 3723],
    [`https://www.youtube.com/embed/${YT}?start=42&autoplay=1&mute=1`, 42],
    [`https://www.youtube-nocookie.com/embed/${YT}?start=7`, 7],
    ['https://vimeo.com/76979871#t=30s', 30],
    ['https://player.vimeo.com/video/76979871#t=2m', 120],
  ])('%s starts at %i', (input, start) => {
    expect(parseVideoUrl(input)?.start).toBe(start);
  });

  it.each([
    `https://youtu.be/${YT}?t=0`,
    `https://youtu.be/${YT}?t=-5`,
    `https://youtu.be/${YT}?t=1.5`,
    `https://youtu.be/${YT}?t=abc`,
    `https://youtu.be/${YT}?t=99999999`,
    `https://youtu.be/${YT}?t=1s1m`,
    `https://youtu.be/${YT}?t=${'9'.repeat(40)}`,
    'https://vimeo.com/76979871#t=',
  ])('ignores an invalid start: %s', (input) => {
    const embed = parseVideoUrl(input);
    expect(embed).not.toBeNull();
    expect(embed?.start).toBeUndefined();
  });

  it('caps a start at 99:59:59', () => {
    expect(parseVideoStart('359999')).toBe(359_999);
    expect(parseVideoStart('360000')).toBeUndefined();
  });
});

describe('parseVideoUrl rejects everything else', () => {
  it.each([
    ['javascript: scheme', `javascript:alert(1)//https://www.youtube.com/embed/${YT}`],
    ['data: scheme', `data:text/html,<iframe src="https://www.youtube.com/embed/${YT}">`],
    ['ftp: scheme', `ftp://www.youtube.com/embed/${YT}`],
    ['look-alike suffix', `https://youtube.com.evil.com/embed/${YT}`],
    ['look-alike prefix', `https://evilyoutube.com/embed/${YT}`],
    ['look-alike subdomain', `https://www.youtube.com.evil.com/watch?v=${YT}`],
    ['unlisted subdomain', `https://music.youtube.com/watch?v=${YT}`],
    ['userinfo', `https://www.youtube.com@evil.com/embed/${YT}`],
    ['userinfo on the real host', `https://user:pass@www.youtube.com/embed/${YT}`],
    ['IDN look-alike', `https://www.yоutube.com/embed/${YT}`],
    ['punycode look-alike', `https://www.xn--ytube-7ve.com/embed/${YT}`],
    ['explicit port', `https://www.youtube.com:8443/embed/${YT}`],
    ['encoded slash in the path', `https://www.youtube.com/embed%2F${YT}`],
    ['encoded slash in the id', `https://www.youtube.com/embed/${YT}%2F..`],
    ['double slash', `https://www.youtube.com//embed/${YT}`],
    ['extra segment', `https://www.youtube.com/embed/${YT}/extra`],
    ['short id', 'https://www.youtube.com/watch?v=abc'],
    ['long id', `https://www.youtube.com/watch?v=${YT}x`],
    ['id with a bad character', 'https://youtu.be/dQw4w9WgX.Q'],
    ['watch without v', 'https://www.youtube.com/watch?list=PL1'],
    ['channel page', 'https://www.youtube.com/@channel'],
    ['nocookie watch page', `https://www.youtube-nocookie.com/watch?v=${YT}`],
    ['vimeo non-numeric', 'https://vimeo.com/channels'],
    ['vimeo leading zero', 'https://vimeo.com/076979871'],
    ['vimeo unlisted hash path', 'https://vimeo.com/76979871/abcdef1234'],
    ['vimeo too long', `https://vimeo.com/${'1'.repeat(13)}`],
    ['loom upper-case id', `https://www.loom.com/share/${LOOM.toUpperCase()}`],
    ['loom short id', 'https://www.loom.com/share/0123'],
    ['loom other page', `https://www.loom.com/looms/${LOOM}`],
    ['wistia nested subdomain', 'https://a.b.wistia.com/medias/abc123def4'],
    ['wistia bare domain', 'https://wistia.com/medias/abc123def4'],
    ['wistia id with upper case', 'https://acme.wistia.com/medias/ABC123DEF4'],
    ['wistia other host', 'https://fast.wistia.com.evil.net/embed/iframe/abc123def4'],
    ['relative path', `/embed/${YT}`],
    ['empty', ''],
    ['not a URL', 'youtube'],
    ['over-long', `https://www.youtube.com/watch?v=${YT}&x=${'a'.repeat(2100)}`],
  ])('%s', (_name, input) => {
    expect(parseVideoUrl(input)).toBeNull();
  });
});

describe('player and page addresses', () => {
  it('builds the canonical player per provider, with autoplay only when asked', () => {
    expect(videoEmbedSrc({ provider: 'youtube', id: YT })).toBe(`https://www.youtube-nocookie.com/embed/${YT}`);
    expect(videoEmbedSrc({ provider: 'youtube', id: YT, start: 30 }, true)).toBe(`https://www.youtube-nocookie.com/embed/${YT}?start=30&autoplay=1`);
    expect(videoEmbedSrc({ provider: 'vimeo', id: '1', start: 5 }, true)).toBe('https://player.vimeo.com/video/1?autoplay=1#t=5s');
    expect(videoEmbedSrc({ provider: 'loom', id: LOOM }, true)).toBe(`https://www.loom.com/embed/${LOOM}`);
    expect(videoEmbedSrc({ provider: 'wistia', id: 'abc123def4' }, true)).toBe('https://fast.wistia.net/embed/iframe/abc123def4?autoPlay=true');
  });

  it('only ever points players at the CSP frame-src origins', () => {
    for (const provider of ['youtube', 'vimeo', 'loom', 'wistia'] as const) {
      const id = { youtube: YT, vimeo: '1', loom: LOOM, wistia: 'abc123def4' }[provider];
      expect(VIDEO_EMBED_ORIGINS).toContain(new URL(videoEmbedSrc({ provider, id }, true)).origin);
    }
  });

  it('round-trips canonical players through the parser, start included', () => {
    for (const embed of [
      { provider: 'youtube', id: YT, start: 12 },
      { provider: 'vimeo', id: '76979871', start: 3 },
      { provider: 'loom', id: LOOM },
      { provider: 'wistia', id: 'abc123def4' },
    ] as const) {
      expect(parseVideoUrl(videoEmbedSrc(embed))).toEqual(embed);
      expect(parseVideoUrl(videoPageUrl(embed))).toEqual(embed);
    }
  });

  it('validates stored attributes again', () => {
    expect(videoEmbedFrom('youtube', YT, '30')).toEqual({ provider: 'youtube', id: YT, start: 30 });
    expect(videoEmbedFrom('youtube', YT, 30)).toEqual({ provider: 'youtube', id: YT, start: 30 });
    expect(videoEmbedFrom('youtube', YT, 'x')).toEqual({ provider: 'youtube', id: YT });
    expect(videoEmbedFrom('youtube', `${YT}"onload="x`)).toBeNull();
    expect(videoEmbedFrom('vimeo', YT)).toBeNull();
    expect(videoEmbedFrom('dailymotion', YT)).toBeNull();
    expect(videoEmbedFrom('__proto__', YT)).toBeNull();
    expect(videoEmbedFrom('toString', YT)).toBeNull();
    expect(videoEmbedFrom(undefined, undefined)).toBeNull();
  });
});

describe('web and media addresses', () => {
  it('parses absolute http(s) addresses without credentials', () => {
    expect(parseWebUrl('https://example.com:8443/a')?.host).toBe('example.com:8443');
    expect(parseWebUrl('//example.com/a')?.protocol).toBe('https:');
    expect(parseWebUrl('https://u:p@example.com/')).toBeNull();
    expect(parseWebUrl('javascript:alert(1)')).toBeNull();
    expect(parseWebUrl('/relative')).toBeNull();
  });

  it.each([
    ['https://cdn.example.com/a.mp4', true],
    ['HTTPS://cdn.example.com/a.mp4', true],
    ['/api/public/projects/p/assets/a.mp4', true],
    ['http://cdn.example.com/a.mp4', false],
    ['//cdn.example.com/a.mp4', false],
    ['/\\cdn.example.com/a.mp4', false],
    ['javascript:alert(1)', false],
    ['data:video/mp4;base64,AAAA', false],
    ['blob:https://example.com/x', false],
    ['https://user@cdn.example.com/a.mp4', false],
    ['a.mp4', false],
    [undefined, false],
  ])('media address %s allowed: %s', (value, allowed) => {
    expect(isAllowedMediaUrl(value)).toBe(allowed);
  });

  // A browser strips tab and newline from a URL and reads `\` as `/`, so these
  // resolve to another host however they are spelled in the source.
  it.each([
    ['tab', '/\t/tracker.example/x.mp4'],
    ['newline', '/\n/tracker.example/x.mp4'],
    ['carriage return', '/\r/tracker.example/x.mp4'],
    ['backslash', '/\\/tracker.example/x.mp4'],
    ['slash, backslash', '/\\/evil'],
    ['protocol-relative', '//evil'],
    ['tab inside https', 'https://cdn.exa\tmple.com/a.mp4'],
    ['NUL', '/assets/a.mp4\u0000'],
    ['DEL', '/assets/\u007fa.mp4'],
    ['space inside', '/assets/a b.mp4'],
  ])('rejects a media address with a %s', (_name, value) => {
    expect(isAllowedMediaUrl(value)).toBe(false);
  });

  it('keeps a path on this site, including a percent-encoded tab, which the URL parser leaves in the path', () => {
    expect(isAllowedMediaUrl('/assets/x.mp4')).toBe(true);
    // `%09` is not decoded while resolving, so `/%09/evil` stays a path on this site.
    expect(isAllowedMediaUrl('/%09/evil')).toBe(true);
    expect(new URL('/%09/evil', 'https://docs.example.com').host).toBe('docs.example.com');
  });
});
