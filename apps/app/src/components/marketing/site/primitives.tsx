import type { ReactNode } from 'react';

const buttonBase =
  'inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md px-4 py-2 font-medium text-sm transition-colors motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
export const primaryButton = `${buttonBase} bg-primary text-primary-foreground hover:bg-primary/90`;
export const outlineButton = `${buttonBase} border border-border bg-background hover:bg-muted`;
export const invertedOutlineButton = `${buttonBase} border border-background/25 text-background hover:bg-background/10`;
export const iconTile = 'grid place-items-center rounded-lg border border-border bg-background text-foreground';

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="font-medium text-primary text-sm leading-7">{children}</p>;
}
