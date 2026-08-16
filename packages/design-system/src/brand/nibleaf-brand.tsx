import type { ComponentProps } from 'react';
import { cn } from '../lib/utils';

export function NibleafMark({
  className,
  title = 'Nibleaf',
  variant = 'tile',
  ...props
}: ComponentProps<'svg'> & { title?: string; variant?: 'tile' | 'bare' }) {
  return (
    <svg
      aria-label={title}
      className={cn(variant === 'tile' && 'overflow-hidden rounded-[22%]', className)}
      role="img"
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      {variant === 'tile' ? <rect fill="#181612" height="512" rx="104" width="512" /> : null}
      <path
        d="M148 368V144L364 368V144"
        fill="none"
        stroke={variant === 'tile' ? '#FBF7EE' : 'currentColor'}
        strokeLinecap="square"
        strokeLinejoin="round"
        strokeWidth="88"
      />
    </svg>
  );
}

export function NibleafWordmark({ className, title = 'Nibleaf', ...props }: ComponentProps<'span'> & { title?: string }) {
  // The brand name is always set in Latin script "Nibleaf", including in
  // Arabic-locale UI (same as how "Mintlify" stays Latin in Arabic copy).
  return (
    <span
      aria-label={title}
      className={cn('inline-block select-none font-extrabold leading-none tracking-normal', className)}
      dir="ltr"
      role="img"
      {...props}
    >
      Nibleaf
    </span>
  );
}
