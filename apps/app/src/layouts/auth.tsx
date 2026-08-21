import { NibleafMark } from '@nibleaf/design-system/brand';
import { Cloud, Globe2, Languages, ShieldCheck } from 'lucide-react';
import type { ComponentType, ReactNode, SVGProps } from 'react';
import { InterfaceLanguageButton } from '@/components/interface-language-dialog';
import { useT } from '@/lib/i18n';

/**
 * Auth chrome — a premium split: a dark, brand-led panel (value props +
 * cloud-product positioning) beside a focused form card. The brand panel is
 * decorative marketing copy (English, hidden below lg); the form heading uses
 * the localized `subtitle` each page passes.
 */
const BRAND_POINTS: { icon: ComponentType<SVGProps<SVGSVGElement>>; key: 'auth.brand.domains' | 'auth.brand.hosting' | 'auth.brand.multilingual' }[] =
  [
    { icon: Cloud, key: 'auth.brand.hosting' },
    { icon: Globe2, key: 'auth.brand.domains' },
    { icon: Languages, key: 'auth.brand.multilingual' },
  ];

export function AuthLayout({ children, subtitle }: { children: ReactNode; subtitle?: string }) {
  const t = useT();
  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div
        className="relative hidden flex-col justify-between overflow-hidden p-12 text-white lg:flex"
        style={{ background: 'linear-gradient(155deg, #1c1c1e 0%, #151517 55%, #101012 100%)' }}
      >
        {/* Terracotta glow and a faint dot grid using the shared design-system tokens. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(60% 45% at 82% 8%, rgba(249,115,22,0.18), transparent 60%)' }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.14]"
          style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.35) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
        />
        <div className="relative flex items-center gap-2.5">
          <NibleafMark className="size-8 text-white" variant="bare" />
          <span className="font-semibold text-lg tracking-tight">Nibleaf</span>
        </div>
        <div className="relative">
          <h2 className="font-semibold text-[2rem] leading-[1.15] tracking-tight">{t('auth.brand.heading')}</h2>
          <p className="mt-3 max-w-md text-sm text-white/65 leading-relaxed">{t('auth.brand.description')}</p>
          <ul className="mt-8 space-y-3.5">
            {BRAND_POINTS.map((point) => (
              <li key={point.key} className="flex items-center gap-3 text-sm text-white/90">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/10 ring-1 ring-white/10">
                  <point.icon className="size-3.5 text-[#F97316]" />
                </span>
                {t(point.key)}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative flex items-center gap-2 text-white/55 text-xs">
          <span className="size-1.5 rounded-full bg-emerald-400" />
          {t('auth.brand.status')}
          <span className="ms-auto inline-flex items-center gap-1 font-mono text-white/40">
            <ShieldCheck className="size-3" /> {t('auth.brand.openSource')}
          </span>
        </div>
      </div>

      {/* Form panel */}
      <div className="relative grid place-items-center bg-background px-6 py-12">
        <InterfaceLanguageButton className="absolute top-4 end-4 max-w-[calc(100%-2rem)]" />
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center gap-3 text-center lg:hidden">
            <div className="inline-flex items-center gap-2">
              <NibleafMark className="size-7" />
              <span className="font-semibold text-2xl tracking-tight">Nibleaf</span>
            </div>
          </div>
          {subtitle ? <h1 className="mb-6 text-center font-semibold text-2xl tracking-tight lg:text-start">{subtitle}</h1> : null}
          {children}
        </div>
      </div>
    </main>
  );
}
