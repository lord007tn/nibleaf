/**
 * The video providers a page may embed, and how a URL maps to one. Pure and
 * dependency-free: the reader's source normalization (`./reader-markdown`), the
 * reader's player, the publish checks and the importers all read embeds with it,
 * so they agree on what plays inline and what stays a link.
 *
 * Parsing uses `URL` and plain string checks. The only regular expressions are
 * the anchored, length-bounded id and start-time patterns below.
 *
 * | Provider | Accepted input                                                  | Embedded as                               |
 * |----------|-----------------------------------------------------------------|-------------------------------------------|
 * | YouTube  | watch?v=, youtu.be/, /shorts/, /embed/, youtube-nocookie.com/embed/ | https://www.youtube-nocookie.com/embed/ID |
 * | Vimeo    | vimeo.com/ID, player.vimeo.com/video/ID                         | https://player.vimeo.com/video/ID         |
 * | Loom     | loom.com/share/ID, loom.com/embed/ID                            | https://www.loom.com/embed/ID             |
 * | Wistia   | *.wistia.com/medias/ID, fast.wistia.net/embed/iframe/ID         | https://fast.wistia.net/embed/iframe/ID   |
 *
 * A start time (YouTube `t`/`start`, Vimeo `#t=`) is kept as whole seconds;
 * every other parameter is dropped.
 */

export type VideoProvider = 'youtube' | 'vimeo' | 'loom' | 'wistia';

export interface VideoEmbed {
  provider: VideoProvider;
  id: string;
  /** Whole seconds, 1 or more; absent to start at the beginning. */
  start?: number;
}

/** Display names. Proper nouns: the same in every language. */
export const VIDEO_PROVIDER_NAMES: Readonly<Record<VideoProvider, string>> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
  loom: 'Loom',
  wistia: 'Wistia',
};

/** The only origins an embedded player is loaded from (the CSP's `frame-src`). */
export const VIDEO_EMBED_ORIGINS: readonly string[] = [
  'https://www.youtube-nocookie.com',
  'https://player.vimeo.com',
  'https://www.loom.com',
  'https://fast.wistia.net',
];

/** Each provider's id alphabet and length, anchored and bounded. */
const VIDEO_IDS: Readonly<Record<VideoProvider, RegExp>> = {
  youtube: /^[A-Za-z0-9_-]{11}$/,
  vimeo: /^[1-9][0-9]{0,11}$/,
  loom: /^[0-9a-f]{32}$/,
  wistia: /^[a-z0-9]{10}$/,
};

/** 99:59:59, the longest start a player is asked for. */
const MAX_START = 359_999;
/** `90`, `90s`, `1m30s`, `1h2m3s`: each part bounded, in a fixed order. */
const START = /^(?:([0-9]{1,2})h)?(?:([0-9]{1,4})m)?(?:([0-9]{1,6})s?)?$/;
/** Longer input is not a video link. */
const MAX_URL_LENGTH = 2048;

const isProvider = (value: string): value is VideoProvider => Object.hasOwn(VIDEO_IDS, value);

/** Whole seconds from a start parameter, or undefined when absent or invalid. */
export const parseVideoStart = (value: string | null | undefined): number | undefined => {
  if (!value || value.length > 16) return undefined;
  const match = START.exec(value);
  if (!match) return undefined;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return seconds >= 1 && seconds <= MAX_START ? seconds : undefined;
};

/** A provider, id and start as stored on the reader's element, validated again
 *  (so a hand-written element can't point a player anywhere else). */
export const videoEmbedFrom = (provider: unknown, id: unknown, start?: unknown): VideoEmbed | null => {
  if (typeof provider !== 'string' || typeof id !== 'string' || !isProvider(provider) || !VIDEO_IDS[provider].test(id)) return null;
  const seconds = parseVideoStart(typeof start === 'number' ? String(start) : typeof start === 'string' ? start : undefined);
  return seconds ? { provider, id, start: seconds } : { provider, id };
};

/** The path's segments, ignoring one trailing slash; empty inner segments are kept, so `//` never matches. */
const segments = (pathname: string): string[] => (pathname.endsWith('/') ? pathname.slice(0, -1) : pathname).split('/').slice(1);

/** An absolute http(s) URL without credentials (`//host` reads as https), or null. */
export const parseWebUrl = (input: string): URL | null => {
  const value = input.trim();
  if (!value || value.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(value.startsWith('//') ? `https:${value}` : value);
  } catch {
    return null;
  }
  return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url : null;
};

/** `account.wistia.com`: exactly one label before the provider's domain. */
const isWistiaAccountHost = (host: string): boolean => {
  const account = host.endsWith('.wistia.com') ? host.slice(0, -'.wistia.com'.length) : '';
  return account.length > 0 && !account.includes('.');
};

const fragmentStart = (hash: string): string | null => (hash.startsWith('#t=') ? hash.slice(3) : null);

/**
 * The provider video a URL points to, or null for anything else: another host
 * (look-alikes included: hosts are compared whole, after IDN conversion), a
 * malformed URL, credentials, a port, a non-http(s) scheme, an id outside the
 * provider's alphabet or length, or a path of another shape.
 */
export const parseVideoUrl = (input: string): VideoEmbed | null => {
  const url = parseWebUrl(input);
  if (!url || url.port) return null;
  const host = url.hostname;
  const path = segments(url.pathname);
  let provider: VideoProvider | null = null;
  let id: string | undefined;
  let start: string | null = null;
  if (host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com') {
    provider = 'youtube';
    if (path.length === 1 && path[0] === 'watch') id = url.searchParams.get('v') ?? undefined;
    else if (path.length === 2 && (path[0] === 'shorts' || path[0] === 'embed')) id = path[1];
    start = url.searchParams.get('t') ?? url.searchParams.get('start');
  } else if (host === 'youtu.be') {
    provider = 'youtube';
    if (path.length === 1) id = path[0];
    start = url.searchParams.get('t') ?? url.searchParams.get('start');
  } else if (host === 'youtube-nocookie.com' || host === 'www.youtube-nocookie.com') {
    provider = 'youtube';
    if (path.length === 2 && path[0] === 'embed') id = path[1];
    start = url.searchParams.get('start') ?? url.searchParams.get('t');
  } else if (host === 'vimeo.com' || host === 'www.vimeo.com') {
    provider = 'vimeo';
    if (path.length === 1) id = path[0];
    start = fragmentStart(url.hash);
  } else if (host === 'player.vimeo.com') {
    provider = 'vimeo';
    if (path.length === 2 && path[0] === 'video') id = path[1];
    start = fragmentStart(url.hash);
  } else if (host === 'loom.com' || host === 'www.loom.com') {
    provider = 'loom';
    if (path.length === 2 && (path[0] === 'share' || path[0] === 'embed')) id = path[1];
  } else if (host === 'fast.wistia.net') {
    provider = 'wistia';
    if (path.length === 3 && path[0] === 'embed' && path[1] === 'iframe') id = path[2];
  } else if (isWistiaAccountHost(host)) {
    provider = 'wistia';
    if (path.length === 2 && path[0] === 'medias') id = path[1];
  }
  return provider ? videoEmbedFrom(provider, id, start ?? undefined) : null;
};

/** The player URL. `autoplay` is for after the reader pressed play, on providers that take it. */
export const videoEmbedSrc = ({ provider, id, start }: VideoEmbed, autoplay = false): string => {
  switch (provider) {
    case 'youtube': {
      const query = [start ? `start=${start}` : '', autoplay ? 'autoplay=1' : ''].filter(Boolean).join('&');
      return `https://www.youtube-nocookie.com/embed/${id}${query ? `?${query}` : ''}`;
    }
    case 'vimeo':
      return `https://player.vimeo.com/video/${id}${autoplay ? '?autoplay=1' : ''}${start ? `#t=${start}s` : ''}`;
    case 'loom':
      return `https://www.loom.com/embed/${id}`;
    default: // wistia
      return `https://fast.wistia.net/embed/iframe/${id}${autoplay ? '?autoPlay=true' : ''}`;
  }
};

/** The provider's own page for the video: where the reader goes without JavaScript. */
export const videoPageUrl = ({ provider, id, start }: VideoEmbed): string => {
  switch (provider) {
    case 'youtube':
      return `https://www.youtube.com/watch?v=${id}${start ? `&t=${start}s` : ''}`;
    case 'vimeo':
      return `https://vimeo.com/${id}${start ? `#t=${start}s` : ''}`;
    case 'loom':
      return `https://www.loom.com/share/${id}`;
    default: // wistia
      return videoEmbedSrc({ provider, id });
  }
};

/** A fixed origin to resolve site paths against: only whether the result stays on it matters. */
const SITE_BASE = new URL('https://site.nibleaf.invalid');

/**
 * Whether a `<video>`/`<source>`/`<track>` address or a poster may be used:
 * https, or a path on this site (our own assets).
 *
 * A browser removes tab and newline anywhere in a URL and reads `\` as `/`, so
 * `/<tab>/host/x` or `/\host/x` is another host to it. Any ASCII control
 * character, space or backslash is refused outright; a path must then still
 * resolve to this site's origin. Percent-encoded bytes (`/%09/x`) are not
 * decoded while resolving, so they stay in the path on this site.
 */
export const isAllowedMediaUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const url = value.trim();
  if (!url || url.length > MAX_URL_LENGTH) return false;
  for (let index = 0; index < url.length; index++) {
    const code = url.charCodeAt(index);
    if (code <= 0x20 || code === 0x7f || code === 0x5c) return false;
  }
  if (url.startsWith('/')) {
    try {
      return new URL(url, SITE_BASE).origin === SITE_BASE.origin;
    } catch {
      return false;
    }
  }
  return url.slice(0, 8).toLowerCase() === 'https://' && parseWebUrl(url)?.protocol === 'https:';
};

/**
 * Whether a video poster may be shown: a file on this site only. A browser loads
 * a poster as soon as the page renders (`preload="none"` doesn't stop it), so a
 * poster from another site would contact it before the reader pressed play.
 */
export const isSiteMediaPath = (value: unknown): value is string => isAllowedMediaUrl(value) && value.trim().startsWith('/');
