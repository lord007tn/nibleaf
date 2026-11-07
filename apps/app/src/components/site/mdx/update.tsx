import type { ReactNode } from 'react';

// ─── Update (changelog entry) ─────────────────────────────────────────────────

export function Update({ label, description, children }: { label?: string; description?: string; children?: ReactNode }) {
  return (
    <div className="my-6 border-border border-s ps-6">
      {label ? (
        <span className="-ms-[calc(1.5rem+0.5px)] mb-2 inline-block rounded-full border border-border bg-card px-3 py-0.5 font-medium text-xs">
          {label}
        </span>
      ) : null}
      {description ? <div className="mb-2 text-muted-foreground text-sm">{description}</div> : null}
      <div className="[&>:first-child]:mt-0 [&>:last-child]:mb-0">{children}</div>
    </div>
  );
}
