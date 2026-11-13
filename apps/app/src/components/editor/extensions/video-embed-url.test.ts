import { describe, expect, it } from 'vitest';
import { embedTargetFor, formatStartTime, isEmbeddableVideoLink, parseStartTime } from './video-embed-url';

const YT = 'M7lc1UVf-VE';
const LOOM = '0123456789abcdef0123456789abcdef';

describe('embedTargetFor (through @nibleaf/shared/video-embeds)', () => {
  it.each([
    [`https://www.youtube.com/watch?v=${YT}&t=90`, `https://www.youtube-nocookie.com/embed/${YT}?start=90`],
    [`https://youtu.be/${YT}`, `https://www.youtube-nocookie.com/embed/${YT}`],
    [`https://www.youtube.com/shorts/${YT}`, `https://www.youtube-nocookie.com/embed/${YT}`],
    ['https://vimeo.com/76979871#t=1m30s', 'https://player.vimeo.com/video/76979871#t=90s'],
    [`https://www.loom.com/share/${LOOM}`, `https://www.loom.com/embed/${LOOM}`],
    ['https://acme.wistia.com/medias/abcde12345', 'https://fast.wistia.net/embed/iframe/abcde12345'],
  ])('turns the provider link %s into its canonical player', (input, src) => {
    expect(embedTargetFor(input, 'video')).toEqual({ kind: 'iframe', src });
    expect(embedTargetFor(` ${input} `, 'embed')).toEqual({ kind: 'iframe', src });
  });

  it('turns an https .mp4 or .webm link into a video, in either block', () => {
    expect(embedTargetFor('https://cdn.example.com/demo.mp4', 'video')).toEqual({ kind: 'video', src: 'https://cdn.example.com/demo.mp4' });
    expect(embedTargetFor('https://cdn.example.com/Demo.WEBM?v=2', 'embed')).toEqual({ kind: 'video', src: 'https://cdn.example.com/Demo.WEBM?v=2' });
  });

  it('takes any other https page in the Embed block only', () => {
    expect(embedTargetFor('https://maps.example.com/embed?q=1', 'embed')).toEqual({ kind: 'iframe', src: 'https://maps.example.com/embed?q=1' });
    expect(embedTargetFor('https://maps.example.com/embed?q=1', 'video')).toBeNull();
    // A look-alike host is not the provider: in the Video block it's refused, in the Embed block it's a link card.
    expect(embedTargetFor(`https://www.youtube.com.evil.example/watch?v=${YT}`, 'video')).toBeNull();
    expect(embedTargetFor(`https://www.youtube.com.evil.example/watch?v=${YT}`, 'embed')?.kind).toBe('iframe');
  });

  it.each([
    ['http', `http://www.youtube.com/watch?v=${YT}`],
    ['http file', 'http://cdn.example.com/demo.mp4'],
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:video/mp4;base64,AAAA'],
    ['a site path', '/videos/demo.mp4'],
    ['protocol-relative', '//cdn.example.com/demo.mp4'],
    ['credentials', 'https://user:pass@cdn.example.com/demo.mp4'],
    ['tab', `https://www.you\ttube.com/watch?v=${YT}`],
    ['newline', 'https://cdn.example.com/de\nmo.mp4'],
    ['carriage return', `https://youtu.be/${YT}\r`.concat('x')],
    ['NUL', 'https://cdn.example.com/\u0000demo.mp4'],
    ['DEL', 'https://cdn.example.com/\u007fdemo.mp4'],
    ['inner space', 'https://cdn.example.com/my demo.mp4'],
    ['backslash', 'https://cdn.example.com\\evil.example/demo.mp4'],
    ['empty', '   '],
  ])('refuses %s', (_name, input) => {
    expect(embedTargetFor(input, 'video')).toBeNull();
    expect(embedTargetFor(input, 'embed')).toBeNull();
  });

  it('says which pasted links the Video block plays', () => {
    expect(isEmbeddableVideoLink(`https://youtu.be/${YT}`)).toBe(true);
    expect(isEmbeddableVideoLink('https://cdn.example.com/demo.webm')).toBe(true);
    expect(isEmbeddableVideoLink('https://example.com/docs')).toBe(false);
    expect(isEmbeddableVideoLink('https://example.com/photo.png')).toBe(false);
  });
});

describe('start times', () => {
  it.each([
    ['', undefined],
    ['0', undefined],
    ['90', 90],
    ['1:30', 90],
    ['01:02:03', 3723],
    ['1m30s', 90],
    ['99:59:59', 359_999],
    ['1:60', null],
    ['1:75:00', null],
    ['100:00:00', null],
    ['-5', null],
    ['ninety', null],
  ])('reads %j as %j', (input, seconds) => {
    expect(parseStartTime(input)).toBe(seconds);
  });

  it('shows seconds as a clock', () => {
    expect(formatStartTime(undefined)).toBe('');
    expect(formatStartTime(90)).toBe('1:30');
    expect(formatStartTime(3723)).toBe('1:02:03');
  });
});
