import { blockDirection } from '@nibleaf/shared/script-direction';
import type { ReactNode } from 'react';

// ─── Steps ──────────────────────────────────────────────────────────────────

export function Steps({ children }: { children?: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noRedundantRoles: preserves list semantics in Safari when list-style is none.
    <ol className="reader-steps my-5 flex list-none flex-col gap-6 border-border border-s ps-6" role="list">
      {children}
    </ol>
  );
}

export function Step({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <li className="relative [&>:first-child]:mt-0 [&>:last-child]:mb-0">
      {title ? (
        <div className="mb-1 font-semibold" dir={blockDirection(title)}>
          {title}
        </div>
      ) : null}
      {children}
    </li>
  );
}
