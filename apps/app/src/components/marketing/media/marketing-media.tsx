import { Play } from 'lucide-react';
import { useState } from 'react';
import type { MarketingLang, MediaRef } from '../copy/types';
import { type ImageVariant, type MediaEntry, marketingMedia } from './manifest';

const wideSizes = '(max-width: 639px) calc(100vw - 40px), (max-width: 1023px) calc(100vw - 48px), (max-width: 1279px) 46vw, 580px';
const overlaySizes = '(max-width: 639px) 17rem, 15rem';
/** 1×1 transparent GIF: below `sm` a hidden hero capture resolves to this instead of downloading. */
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

function Capture({
  wide,
  phone,
  darkWide,
  alt,
  priority,
  className,
  phoneSizes = false,
  hideBelowSm = false,
}: {
  wide: ImageVariant;
  phone?: ImageVariant;
  /** Dark capture picked by the system colour scheme, so one eager image serves both themes. */
  darkWide?: ImageVariant;
  alt: string;
  priority: boolean;
  className?: string;
  /** Size hints for the small phone overlay instead of a full column. */
  phoneSizes?: boolean;
  /** The capture is hidden below `sm`: resolve to a blank pixel there so it never downloads. */
  hideBelowSm?: boolean;
}) {
  const sizes = phoneSizes ? overlaySizes : wideSizes;
  return (
    <picture className={className}>
      {hideBelowSm && <source media="(max-width: 639px)" srcSet={BLANK} />}
      {phone && (
        <>
          <source media="(max-width: 639px)" type="image/avif" srcSet={phone.avif} sizes={sizes} width={phone.width} height={phone.height} />
          <source media="(max-width: 639px)" type="image/webp" srcSet={phone.webp} sizes={sizes} width={phone.width} height={phone.height} />
        </>
      )}
      {darkWide && (
        <>
          <source
            media="(prefers-color-scheme: dark)"
            type="image/avif"
            srcSet={darkWide.avif}
            sizes={sizes}
            width={darkWide.width}
            height={darkWide.height}
          />
          <source
            media="(prefers-color-scheme: dark)"
            type="image/webp"
            srcSet={darkWide.webp}
            sizes={sizes}
            width={darkWide.width}
            height={darkWide.height}
          />
        </>
      )}
      <source type="image/avif" srcSet={wide.avif} sizes={sizes} width={wide.width} height={wide.height} />
      <source type="image/webp" srcSet={wide.webp} sizes={sizes} width={wide.width} height={wide.height} />
      <img
        src={wide.fallback}
        alt={alt}
        width={wide.width}
        height={wide.height}
        sizes={sizes}
        decoding="async"
        loading={priority ? 'eager' : 'lazy'}
        fetchPriority={priority ? 'high' : undefined}
        className="block h-auto w-full"
      />
    </picture>
  );
}

/**
 * A real screen recording, loaded only when the visitor asks for it. Until then
 * the page shows a lazy still frame with a play button; a `<video poster>` would
 * fetch the poster with the page and compete with first paint.
 */
function RecordingMedia({
  lang,
  poster,
  video,
  media,
}: {
  lang: MarketingLang;
  poster: ImageVariant;
  video: NonNullable<MediaEntry['video']>;
  media: MediaRef;
}) {
  const [playing, setPlaying] = useState(false);
  const playLabel = lang === 'ar' ? 'شغّل التسجيل' : 'Play the recording';
  return (
    <figure className="min-w-0">
      <div className="relative overflow-hidden rounded-xl border border-border bg-card shadow-foreground/5 shadow-xl">
        {playing ? (
          <video
            aria-label={media.alt}
            autoPlay
            className="block h-auto w-full bg-black"
            controls
            height={video.height}
            muted
            playsInline
            src={video.src}
            width={video.width}
          />
        ) : (
          <>
            <Capture wide={poster} alt={media.alt} priority={false} />
            <button
              type="button"
              onClick={() => setPlaying(true)}
              className="absolute inset-0 grid place-items-center bg-foreground/10 transition-colors hover:bg-foreground/20 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-[-4px]"
            >
              <span className="inline-flex min-h-11 items-center gap-2 rounded-full bg-background px-5 font-medium text-foreground text-sm shadow-lg">
                <Play aria-hidden="true" className="size-4 fill-current rtl:rotate-180" />
                {playLabel}
              </span>
            </button>
          </>
        )}
      </div>
      {media.caption && <figcaption className="mt-3 text-muted-foreground text-xs leading-6">{media.caption}</figcaption>}
    </figure>
  );
}

/**
 * Hero composition: the published docs page (desktop capture) with the Ask AI
 * answer on a phone (phone capture) overlapping its end corner. Both are real
 * captures. Below `sm` only the phone shows, so the first screen stays light.
 */
export function HeroMedia({ lang, media }: { lang: MarketingLang; media: MediaRef }) {
  const entry = marketingMedia(lang, media.key);
  if (!entry?.phone) return <MarketingMedia lang={lang} media={media} priority />;
  return (
    <figure className="min-w-0">
      <div className="relative pb-6 sm:pe-16 sm:pb-10">
        <div aria-hidden="true" className="hidden overflow-hidden rounded-xl border border-border bg-card shadow-foreground/5 shadow-xl sm:block">
          <div aria-hidden="true" className="flex h-8 items-center gap-1.5 border-border border-b bg-muted/70 px-3">
            <span className="size-2 rounded-full bg-muted-foreground/30" />
            <span className="size-2 rounded-full bg-muted-foreground/30" />
            <span className="size-2 rounded-full bg-muted-foreground/30" />
          </div>
          <Capture wide={entry.wide} darkWide={entry.wideDark} alt="" priority hideBelowSm className="block" />
        </div>
        <div className="mx-auto w-[min(17rem,78%)] overflow-hidden rounded-[2rem] border-[6px] border-foreground/85 bg-card shadow-2xl sm:absolute sm:end-0 sm:bottom-0 sm:mx-0 sm:w-[38%] sm:max-w-[15rem]">
          {/* Lazy: below `sm` the phone sits under the hero copy, past the first screen. */}
          <Capture wide={entry.phone} alt={media.alt} priority={false} className="block" phoneSizes />
        </div>
      </div>
      {media.caption && <figcaption className="mt-1 text-muted-foreground text-xs leading-6">{media.caption}</figcaption>}
    </figure>
  );
}

export function MarketingMedia({
  lang,
  media,
  priority = false,
  framed = 'browser',
}: {
  lang: MarketingLang;
  media: MediaRef;
  priority?: boolean;
  framed?: 'browser' | 'phone' | 'none';
}) {
  const entry = marketingMedia(lang, media.key);
  if (entry?.video) return <RecordingMedia lang={lang} poster={entry.wide} video={entry.video} media={media} />;
  const dark = Boolean(entry?.wideDark || entry?.phoneDark);
  const frame =
    framed === 'phone'
      ? 'mx-auto max-w-[340px] overflow-hidden rounded-[2.25rem] border-[6px] border-foreground/80 bg-card shadow-xl'
      : framed === 'browser'
        ? 'overflow-hidden rounded-xl border border-border bg-card shadow-xl shadow-foreground/5'
        : 'overflow-hidden rounded-lg';
  return (
    <figure className="min-w-0">
      <div className={frame}>
        {framed === 'browser' && (
          <div aria-hidden="true" className="flex h-8 items-center gap-1.5 border-border border-b bg-muted/70 px-3">
            <span className="size-2 rounded-full bg-muted-foreground/30" />
            <span className="size-2 rounded-full bg-muted-foreground/30" />
            <span className="size-2 rounded-full bg-muted-foreground/30" />
          </div>
        )}
        {entry && priority ? (
          // One eager first-screen image; the system colour scheme picks the dark capture.
          <Capture wide={entry.wide} phone={entry.phone} darkWide={entry.wideDark} alt={media.alt} priority className="block" />
        ) : entry ? (
          <>
            <Capture wide={entry.wide} phone={entry.phone} alt={media.alt} priority={false} className={dark ? 'block dark:hidden' : 'block'} />
            {dark && (
              <Capture
                wide={entry.wideDark ?? entry.wide}
                phone={entry.phoneDark ?? entry.phone}
                alt={media.alt}
                priority={false}
                className="hidden dark:block"
              />
            )}
          </>
        ) : (
          <div className="grid aspect-[8/5] place-items-center bg-muted/40 p-8 text-center text-muted-foreground text-sm leading-7">
            <p className="max-w-[48ch]">{media.alt}</p>
          </div>
        )}
      </div>
      {media.caption && <figcaption className="mt-3 text-muted-foreground text-xs leading-6">{media.caption}</figcaption>}
    </figure>
  );
}
