import { readerEmbedSource } from '@nibleaf/shared/reader-embeds';
import { isAllowedMediaUrl, parseVideoStart, parseVideoUrl, parseWebUrl, type VideoEmbed, videoEmbedSrc } from '@nibleaf/shared/video-embeds';

/**
 * What a writer may put in the editor's Video and Embed blocks, decided by the
 * shared provider module (@nibleaf/shared/video-embeds), so the editor, the
 * reader and the publish checks agree:
 *  - a YouTube, Vimeo, Loom or Wistia link becomes the provider's canonical
 *    player address in an `<iframe>`;
 *  - an https link to an `.mp4` or `.webm` file becomes a `<video>`;
 *  - the Embed block also takes any other https page, kept as an `<iframe>`
 *    that the reader shows as a link card.
 * Every address must pass `isAllowedMediaUrl` first: https, and no control
 * character, space or backslash anywhere in it.
 */

export type EmbedIntent = 'video' | 'embed';
export type EmbedKind = 'iframe' | 'video';
export interface EmbedTarget {
  kind: EmbedKind;
  src: string;
}

const VIDEO_FILE = /\.(?:mp4|webm)$/i;

/** An https address that passes the shared media check, parsed; null otherwise. */
const httpsAddress = (value: string): URL | null => {
  if (!isAllowedMediaUrl(value) || value.startsWith('/')) return null;
  const url = parseWebUrl(value);
  return url?.protocol === 'https:' ? url : null;
};

/** The block a writer's address makes, or null when the block can't take it. */
export const embedTargetFor = (input: string, intent: EmbedIntent): EmbedTarget | null => {
  const value = input.trim();
  const url = httpsAddress(value);
  if (!url) return null;
  const video = parseVideoUrl(value);
  if (video) return { kind: 'iframe', src: videoEmbedSrc(video) };
  if (VIDEO_FILE.test(url.pathname)) return { kind: 'video', src: value };
  return intent === 'embed' ? { kind: 'iframe', src: value } : null;
};

/** Whether a pasted or linked address is a video the Video block plays. */
export const isEmbeddableVideoLink = (input: string): boolean => embedTargetFor(input, 'video') !== null;

/** The provider video an iframe address plays, as the reader reads it. */
export const providerVideoOf = (src: string): VideoEmbed | null => {
  const source = readerEmbedSource(src);
  return source?.kind === 'video' ? source.video : null;
};

/** Providers whose player takes a start time (`videoEmbedSrc` writes it). */
export const takesStartTime = (video: VideoEmbed | null): video is VideoEmbed => video?.provider === 'youtube' || video?.provider === 'vimeo';

/** `90` → `1:30`, `3723` → `1:02:03`. */
export const formatStartTime = (seconds: number | undefined): string => {
  if (!seconds) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
};

const CLOCK = /^(?:([0-9]{1,2}):)?([0-9]{1,2}):([0-9]{2})$/;

/**
 * A start time as a writer types it: seconds (`90`), `m:ss` or `h:mm:ss`, or
 * the providers' own `1m30s`. Empty is no start (`undefined`); anything else,
 * or more than 99:59:59, is `null`.
 */
export const parseStartTime = (input: string): number | undefined | null => {
  const value = input.trim();
  if (!value || value === '0' || value === '0:00') return undefined;
  if (value.length > 16) return null;
  const clock = CLOCK.exec(value);
  if (clock) {
    const minutes = Number(clock[2]);
    const seconds = Number(clock[3]);
    if (seconds > 59 || (clock[1] !== undefined && minutes > 59)) return null;
    return parseVideoStart(String(Number(clock[1] ?? 0) * 3600 + minutes * 60 + seconds)) ?? null;
  }
  return parseVideoStart(value) ?? null;
};
