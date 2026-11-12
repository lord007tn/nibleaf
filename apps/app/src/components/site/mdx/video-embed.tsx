import { siteContentT } from '@nibleaf/i18n/site-content';
import { blockDirection } from '@nibleaf/shared/script-direction';
import {
  isAllowedMediaUrl,
  isSiteMediaPath,
  parseWebUrl,
  VIDEO_PROVIDER_NAMES,
  type VideoEmbed as VideoEmbedValue,
  videoEmbedFrom,
  videoEmbedSrc,
  videoPageUrl,
} from '@nibleaf/shared/video-embeds';
import { type ComponentProps, type ReactNode, useState, useSyncExternalStore } from 'react';

/*
 * An authored iframe, as `normalizeMdxBlocks` rewrites it (`<mdxembed>`; see
 * @nibleaf/shared/reader-embeds). Everything here is phrasing content (spans, a
 * button, a link, an iframe), so the element is valid where Markdown leaves it:
 * inside a paragraph.
 *
 * A provider video is a click-to-load facade. Nothing is requested from the
 * provider until the reader presses play: no iframe, no thumbnail, no preconnect.
 * Without JavaScript (and until the page hydrates) the poster is a link to the
 * video on the provider's site.
 */

const noSubscription = () => () => undefined;
/** False on the server and while hydrating, true once the page is interactive. */
const useInteractive = () =>
  useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );

/** The player's fixed permissions: nothing beyond what playback needs. */
const SANDBOX = 'allow-scripts allow-same-origin allow-presentation allow-popups';
const ALLOW = 'encrypted-media; picture-in-picture; fullscreen';

/** Focus moves into the player the reader asked for. Stable, so it runs once, on mount. */
const focusFrame = (frame: HTMLIFrameElement | null) => frame?.focus();

const BOX = 'relative block aspect-video w-full overflow-hidden rounded-xl border border-border bg-muted';
const POSTER =
  'absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-3 p-4 text-center text-foreground no-underline outline-none hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-safe:transition-colors';

function PlayIcon() {
  return (
    <span className="grid size-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm" aria-hidden>
      {/* Media controls keep their direction in right-to-left layouts. */}
      <svg viewBox="0 0 24 24" className="size-6" fill="currentColor" focusable="false">
        <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
      </svg>
    </span>
  );
}

function Poster({ title, provider, note }: { title: string; provider: string; note: string }) {
  return (
    <>
      <PlayIcon />
      <span className="line-clamp-2 max-w-prose font-semibold" dir={blockDirection(title)}>
        {title}
      </span>
      <span className="text-muted-foreground text-xs">
        <bdi dir="ltr" className="font-medium">
          {provider}
        </bdi>
        {' · '}
        {note}
      </span>
    </>
  );
}

function VideoFacade({ embed, title, language }: { embed: VideoEmbedValue; title?: string; language?: string }) {
  const t = siteContentT(language);
  const interactive = useInteractive();
  const [playing, setPlaying] = useState(false);
  const provider = VIDEO_PROVIDER_NAMES[embed.provider];
  const name = title || t('videoUntitled');
  const poster = <Poster title={name} provider={provider} note={t('videoLoadsOnPlay')} />;
  let content: ReactNode;
  if (playing) {
    content = (
      <iframe
        ref={focusFrame}
        src={videoEmbedSrc(embed, true)}
        title={name}
        className="absolute inset-0 size-full border-0"
        sandbox={SANDBOX}
        allow={ALLOW}
        referrerPolicy="strict-origin-when-cross-origin"
        loading="lazy"
      />
    );
  } else if (interactive) {
    content = (
      <button type="button" className={POSTER} aria-label={t('videoPlay', { title: name, provider })} onClick={() => setPlaying(true)}>
        {poster}
      </button>
    );
  } else {
    content = (
      <a className={POSTER} href={videoPageUrl(embed)} aria-label={t('videoWatch', { title: name, provider })}>
        {poster}
      </a>
    );
  }
  return (
    <span className={BOX} data-theme-component="video-embed" data-provider={embed.provider}>
      {content}
    </span>
  );
}

/** A frame from another site: a link to it, showing where it goes. */
function EmbedLink({ url, title }: { url: URL; title?: string }) {
  return (
    <a
      className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4 no-underline hover:border-primary/50 motion-safe:transition-colors"
      data-theme-component="embed-link"
      href={url.href}
      rel="noopener noreferrer"
    >
      {title ? (
        <span className="font-semibold text-foreground" dir={blockDirection(title)}>
          {title}
        </span>
      ) : null}
      <bdi dir="ltr" className="truncate text-muted-foreground text-sm">
        {url.host}
      </bdi>
    </a>
  );
}

/** The reader's `<mdxembed>`: a provider video, a link to another site's frame, or an address shown as text. */
export function VideoEmbed({
  provider,
  videoid,
  start,
  title,
  href,
  text,
  language,
}: {
  provider?: string;
  videoid?: string;
  start?: string | number;
  title?: string;
  href?: string;
  text?: string;
  language?: string;
}) {
  const label = title?.trim() || undefined;
  const embed = videoEmbedFrom(provider, videoid, start);
  if (embed) return <VideoFacade embed={embed} title={label} language={language} />;
  const url = href ? parseWebUrl(href) : null;
  if (url?.protocol === 'https:') return <EmbedLink url={url} title={label} />;
  const address = text ?? href;
  if (!address) return null;
  return (
    <span className="text-muted-foreground">
      {label ? `${label}: ` : null}
      <bdi dir="ltr" className="break-all">
        {address}
      </bdi>
    </span>
  );
}

/** A `<video>` plays only on request: controls are always shown, nothing autoplays
 *  or loads before play, and only https (or this site's) addresses are used. A
 *  poster loads as soon as the page renders (`preload="none"` doesn't stop it), so
 *  only a file on this site is kept; one from another site is left out. */
export function ReaderVideo({ node: _node, src, poster, children }: ComponentProps<'video'> & { node?: unknown }) {
  return (
    // biome-ignore lint/a11y/useMediaCaption: an authored video brings its own captions as `<track>` children (ReaderTrack).
    <video
      className="block aspect-video w-full rounded-xl border border-border bg-black"
      controls
      playsInline
      preload="none"
      src={isAllowedMediaUrl(src) ? src : undefined}
      poster={isSiteMediaPath(poster) ? poster : undefined}
    >
      {children}
    </video>
  );
}

/** A `<source>` keeps an https (or this site's) address only; `picture` sources are unchanged. */
export function ReaderSource({ node: _node, src, ...props }: ComponentProps<'source'> & { node?: unknown }) {
  return <source {...props} src={src === undefined || isAllowedMediaUrl(src) ? src : undefined} />;
}

/** A video's captions or subtitles, from an https (or this site's) address only. */
export function ReaderTrack({ node: _node, src, ...props }: ComponentProps<'track'> & { node?: unknown }) {
  return <track {...props} src={isAllowedMediaUrl(src) ? src : undefined} />;
}
