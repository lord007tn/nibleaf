import type { ReactNode } from 'react';

// ─── Frame ──────────────────────────────────────────────────────────────────

/**
 * An image in a frame fills the frame, unless the writer resized it: an image
 * saved with an explicit `width` (`<img src alt width="480" />`) keeps that
 * size (never wider than the frame). Images reach the frame bare (`img`) or in
 * the published reader's zoom wrapper (`.reader-image`).
 */
const FRAME_MEDIA_CLASSES = [
  '[&>img]:my-0 [&>.reader-image>img]:my-0',
  '[&>img:not([width])]:w-full',
  '[&>.reader-image:not(:has(>img[width]))]:w-full [&>.reader-image>img:not([width])]:w-full',
  '[&_img[width]]:h-auto [&_img[width]]:max-w-full',
].join(' ');

export function Frame({ caption, hint, children }: { caption?: string; hint?: string; children?: ReactNode }) {
  const figure = (
    <figure className="my-5 overflow-hidden rounded-xl border border-border bg-muted/30 p-3">
      <div className={`overflow-hidden rounded-lg ${FRAME_MEDIA_CLASSES}`}>{children}</div>
      {caption ? <figcaption className="mt-2 text-center text-muted-foreground text-xs">{caption}</figcaption> : null}
    </figure>
  );
  if (!hint) return figure;
  // The hint introduces the frame, so it reads before it.
  return (
    <div className="my-5 [&>figure]:mt-2">
      <p className="m-0 text-muted-foreground text-sm">{hint}</p>
      {figure}
    </div>
  );
}
