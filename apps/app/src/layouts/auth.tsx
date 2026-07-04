import { MidadMark } from '@midad/design-system/brand';
import { Languages, Server, ShieldCheck } from 'lucide-react';
import type { ComponentType, ReactNode, SVGProps } from 'react';

/**
 * Auth chrome — a premium split: a dark, brand-led panel (value props +
 * "self-hostable today, cloud soon" positioning) beside a focused form card.
 * The brand panel is decorative marketing copy (English, hidden below lg); the
 * form heading uses the localized `subtitle` each page passes.
 */
const BRAND_POINTS: { icon: ComponentType<SVGProps<SVGSVGElement>>; text: string }[] = [
  { icon: Server, text: 'Self-host on your own infrastructure' },
  { icon: ShieldCheck, text: 'Own your data, storage, and domains' },
  { icon: Languages, text: 'Arabic-ready, RTL-first authoring' },
];

export function AuthLayout({ children, subtitle }: { children: ReactNode; subtitle?: string }) {
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div
        className="relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex"
        style={{ background: 'linear-gradient(155deg, #1d150d 0%, #14100b 55%, #100c08 100%)' }}
      >
        {/* warm umber glow + faint dot grid for depth */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(60% 45% at 82% 8%, rgba(209,138,84,0.22), transparent 60%)' }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.14]"
          style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.35) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
        />
        <div className="relative flex items-center gap-2.5">
          <MidadMark className="size-8 text-white" variant="bare" />
          <span className="font-semibold text-lg tracking-tight">Midad</span>
        </div>
        <div className="relative">
          <h2 className="font-semibold text-[2rem] leading-[1.15] tracking-tight">Docs that stay in your hands.</h2>
          <p className="mt-3 max-w-md text-sm text-white/65 leading-relaxed">
            The open-source documentation platform — write in Markdown, publish a fast searchable site, and keep everything on your own
            infrastructure.
          </p>
          <ul className="mt-8 space-y-3.5">
            {BRAND_POINTS.map((point) => (
              <li key={point.text} className="flex items-center gap-3 text-sm text-white/90">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/10 ring-1 ring-white/10">
                  <point.icon className="size-3.5 text-[#e6a86f]" />
                </span>
                {point.text}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative flex items-center gap-2 text-white/55 text-xs">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          Self-hostable today · Cloud coming soon
          <span className="ms-auto font-mono text-white/40">AGPL-3.0</span>
        </div>
      </div>

      {/* Form panel */}
      <div className="relative grid place-items-center bg-background px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center gap-3 text-center lg:hidden">
            <div className="inline-flex items-center gap-2">
              <MidadMark className="size-7" />
              <span className="font-semibold text-2xl tracking-tight">Midad</span>
            </div>
          </div>
          {subtitle ? <h1 className="mb-6 text-center font-semibold text-2xl tracking-tight lg:text-start">{subtitle}</h1> : null}
          {children}
        </div>
      </div>
    </main>
  );
}
