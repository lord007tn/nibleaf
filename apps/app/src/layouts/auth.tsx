import type { ReactNode } from 'react';
import { MidadMark } from '@midad/design-system/brand';

/** Split auth chrome: a brand panel + a centered form card (matches the design). */
export function AuthLayout({ children, subtitle }: { children: ReactNode; subtitle?: string }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between bg-primary p-12 text-primary-foreground lg:flex">
        <div className="flex items-center gap-2.5">
          <MidadMark className="size-8 text-primary-foreground" variant="bare" />
          <span className="font-semibold text-lg tracking-tight">Midad</span>
        </div>
        <div>
          <h2 className="font-semibold text-3xl leading-tight tracking-tight">Docs that stay in your hands.</h2>
          <p className="mt-3 max-w-md text-primary-foreground/80 text-sm leading-relaxed">
            Open-source documentation publishing with Arabic-ready authoring, search, and self-hosting.
          </p>
        </div>
        <p className="font-mono text-primary-foreground/70 text-xs">Open source · self-hostable</p>
      </div>
      <div className="grid place-items-center bg-background px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-7 text-center lg:hidden">
            <div className="inline-flex items-center gap-2">
              <MidadMark className="size-7" />
              <span className="font-semibold text-2xl tracking-tight">Midad</span>
            </div>
          </div>
          {subtitle ? <p className="mb-6 text-center text-muted-foreground text-sm">{subtitle}</p> : null}
          {children}
        </div>
      </div>
    </main>
  );
}


