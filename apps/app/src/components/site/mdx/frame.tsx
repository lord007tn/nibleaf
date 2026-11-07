import type { ReactNode } from 'react';

// ─── Frame ──────────────────────────────────────────────────────────────────

export function Frame({ caption, children }: { caption?: string; children?: ReactNode }) {
  return (
    <figure className="my-5 overflow-hidden rounded-xl border border-border bg-muted/30 p-3">
      <div className="overflow-hidden rounded-lg [&>img]:my-0 [&>img]:w-full [&>.reader-image]:w-full [&>.reader-image>img]:my-0 [&>.reader-image>img]:w-full">
        {children}
      </div>
      {caption ? <figcaption className="mt-2 text-center text-muted-foreground text-xs">{caption}</figcaption> : null}
    </figure>
  );
}
