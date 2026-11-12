import { NibleafMark } from '@nibleaf/design-system/brand';
import { useT } from '@nibleaf/i18n/react';
import { ArrowLeft, Cloud, Globe2, Languages, ShieldCheck } from 'lucide-react';
import type { ComponentType, ReactNode, SVGProps } from 'react';
import { InterfaceLanguageButton } from '@/components/interface-language-dialog';

/**
 * Auth chrome — a premium split: a dark, brand-led panel (plain-language value
 * props, localized, hidden below lg) beside a focused form card. The form's h1
 * is the localized `subtitle` each page passes, so pages must not add another.
 *
 * The logo and "Back to Nibleaf" lead to the marketing home. Every install
 * serves it from this app at `/` (cloud and self-hosted alike), so the link is
 * same-origin and needs no configured marketing address.
 */
const HOME_HREF = '/';
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
        <a className="relative flex items-center gap-2.5 self-start rounded-md" href={HOME_HREF}>
          <NibleafMark className="size-8 text-white" variant="bare" />
          <span className="font-semibold text-lg tracking-tight">Nibleaf</span>
        </a>
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
        <div className="absolute inset-x-4 top-4 flex items-center justify-between gap-2">
          <a
            className="inline-flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-muted-foreground text-sm hover:text-foreground"
            data-slot="auth-back-home"
            href={HOME_HREF}
          >
            <ArrowLeft aria-hidden className="size-4 shrink-0 rtl:-scale-x-100" />
            <span className="truncate">{t('auth.backToSite', { site: 'Nibleaf' })}</span>
          </a>
          <InterfaceLanguageButton className="min-w-0 max-w-[60%]" />
        </div>
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center gap-3 text-center lg:hidden">
            <a className="inline-flex items-center gap-2 rounded-md" href={HOME_HREF}>
              <NibleafMark className="size-7" />
              <span className="font-semibold text-2xl tracking-tight">Nibleaf</span>
            </a>
          </div>
          {subtitle ? <h1 className="mb-6 text-center font-semibold text-2xl tracking-tight lg:text-start">{subtitle}</h1> : null}
          {children}
        </div>
      </div>
    </main>
  );
}
