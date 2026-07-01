import type { ComponentProps } from 'react';
import { cn } from '../lib/utils';

export function MidadMark({
  className,
  title = 'Midad',
  variant = 'tile',
  ...props
}: ComponentProps<'svg'> & { title?: string; variant?: 'tile' | 'bare' }) {
  const ink = variant === 'tile' ? 'var(--primary-foreground)' : 'currentColor';
  return (
    <svg
      aria-label={title}
      className={cn(variant === 'tile' && 'overflow-hidden rounded-[22%]', className)}
      role="img"
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {variant === 'tile' ? <rect fill="var(--primary)" height="512" rx="104" width="512" /> : null}
      <path d="M183 314 309 188c14-14 37-14 51 0l4 4c14 14 14 37 0 51L238 369l-72 18 17-73Z" fill={ink} />
      <path d="M158 196c34-36 86-44 129-20" fill="none" stroke={ink} strokeLinecap="round" strokeWidth="24" />
      <circle cx="346" cy="338" fill="var(--brand-copper, #B96A3D)" r="27" />
    </svg>
  );
}

export function MidadWordmark({
  className,
  script = 'latin',
  title = script === 'latin' ? 'Midad' : 'مِداد',
  ...props
}: ComponentProps<'span'> & { script?: 'arabic' | 'latin'; title?: string }) {
  const isLatin = script === 'latin';
  return (
    <span
      aria-label={title}
      className={cn('inline-block select-none font-extrabold leading-none tracking-normal', className)}
      dir={isLatin ? 'ltr' : 'rtl'}
      role="img"
      {...props}
    >
      {isLatin ? 'Midad' : 'مِداد'}
    </span>
  );
}
