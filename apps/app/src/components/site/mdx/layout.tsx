import { cn } from '@nibleaf/design-system/lib/utils';
import { Children, type CSSProperties, isValidElement, type ReactNode } from 'react';
import { AuthoredIcon } from './authored-icon';
import { authoredColor, optionalNumber, truthyAttr } from './utils';

// ─── Layout and inline UI ────────────────────────────────────────────────────

const COLUMN_CLASSES = { 1: 'md:grid-cols-1', 2: 'md:grid-cols-2', 3: 'md:grid-cols-3', 4: 'md:grid-cols-4' } as const;

/** `cols` sets the column count (1–4); without it there is one column per child, up to four. */
export function Columns({ cols, children }: { cols?: unknown; children?: ReactNode }) {
  const authored = optionalNumber(cols);
  const inferred = Children.toArray(children).filter(isValidElement).length;
  const count = Math.min(4, Math.max(1, Math.round(authored ?? inferred))) as keyof typeof COLUMN_CLASSES;
  return <div className={cn('my-5 grid grid-cols-1 gap-4', COLUMN_CLASSES[count])}>{children}</div>;
}

export function Column({ children }: { children?: ReactNode }) {
  return <div className="rounded-xl border border-border bg-card p-5 [&>:first-child]:mt-0 [&>:last-child]:mb-0">{children}</div>;
}

export function Banner({ type, children }: { type?: string; children?: ReactNode }) {
  return (
    <div
      className={cn(
        'my-5 rounded-xl border px-4 py-3 text-sm',
        type === 'warning' ? 'border-amber-500/35 bg-amber-500/10' : 'border-primary/30 bg-primary/8',
      )}
    >
      {children}
    </div>
  );
}

// Mintlify's named badge colors, expressed through theme tokens where the theme
// has one, so every theme (and dark mode) keeps its own palette.
const BADGE_TONES: Record<string, string> = {
  gray: 'var(--muted-foreground)',
  blue: '#3b82f6',
  green: 'var(--theme-success,#16a34a)',
  yellow: '#eab308',
  orange: 'var(--theme-warning,#f97316)',
  red: 'var(--theme-danger,var(--destructive))',
  purple: '#a855f7',
};
const SURFACE_BADGES: Record<string, { background: string; tone: string }> = {
  white: { background: 'var(--background)', tone: 'var(--foreground)' },
  surface: { background: 'var(--theme-surface,var(--card))', tone: 'var(--foreground)' },
  'white-destructive': { background: 'var(--background)', tone: 'var(--theme-danger,var(--destructive))' },
  'surface-destructive': { background: 'var(--theme-surface,var(--card))', tone: 'var(--theme-danger,var(--destructive))' },
};
const BADGE_SIZES: Record<string, string> = {
  xs: 'gap-0.5 px-1.5 py-px text-[0.68em] [&_svg]:size-[1em]',
  sm: 'gap-1 px-2 py-0.5 text-[0.72em] [&_svg]:size-[1.05em]',
  md: 'gap-1 px-2 py-0.5 text-[0.78em] [&_svg]:size-[1.1em]',
  lg: 'gap-1.5 px-2.5 py-1 text-[0.88em] [&_svg]:size-[1.1em]',
};

export interface BadgeProps {
  /** A Mintlify color name (gray, blue, …, surface-destructive) or any CSS color. */
  color?: string;
  size?: string;
  shape?: string;
  icon?: string;
  /** Outline instead of a filled background. */
  stroke?: unknown;
  disabled?: unknown;
  children?: ReactNode;
}

export function Badge({ color, size, shape, icon, stroke, disabled, children }: BadgeProps) {
  const named = color ? color.trim().toLowerCase() : 'gray';
  const surface = SURFACE_BADGES[named];
  const tone = surface?.tone ?? BADGE_TONES[named] ?? authoredColor(color) ?? BADGE_TONES.gray;
  const outlined = truthyAttr(stroke);
  const style = {
    '--badge-tone': tone,
    // Mixing the tone into the foreground keeps the text readable on light and dark pages.
    color: 'color-mix(in oklab,var(--badge-tone) 72%,var(--foreground))',
    background: outlined ? 'transparent' : (surface?.background ?? 'color-mix(in oklab,var(--badge-tone) 14%,transparent)'),
    borderColor: surface ? 'var(--border)' : `color-mix(in oklab,var(--badge-tone) ${outlined ? 55 : 22}%,transparent)`,
  } as CSSProperties;
  return (
    <span
      data-color={color}
      data-size={size}
      aria-disabled={truthyAttr(disabled) || undefined}
      style={style}
      className={cn(
        'inline-flex items-center border font-semibold align-middle leading-snug',
        BADGE_SIZES[size ?? 'md'] ?? BADGE_SIZES.md,
        shape === 'pill' ? 'rounded-full' : 'rounded-md',
        truthyAttr(disabled) && 'opacity-55',
      )}
    >
      <AuthoredIcon icon={icon} className="shrink-0" />
      {children}
    </span>
  );
}

export function MdxButton({ href, variant, children }: { href?: string; variant?: string; children?: ReactNode }) {
  return (
    <a
      href={href}
      data-variant={variant}
      className={cn(
        'inline-flex items-center rounded-lg px-3 py-1.5 font-semibold text-sm no-underline',
        variant === 'outline' ? 'border border-border bg-card text-foreground' : 'bg-primary text-primary-foreground',
      )}
    >
      {children}
    </a>
  );
}
