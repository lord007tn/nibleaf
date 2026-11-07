import { hasIcon, PageIcon } from '@/components/site/page-icon';

const EMOJI = /\p{Extended_Pictographic}/u;

/** True for an authored icon the reader can draw: a known icon name or an emoji. */
export const isDrawableIcon = (icon: string | undefined): boolean => Boolean(icon && (hasIcon(icon) || EMOJI.test(icon)));

/**
 * An authored `icon` prop: a named icon from the curated set, or an emoji
 * (Mintlify accepts both). Anything else (remote URLs, SVG source) draws
 * nothing — the reader never fetches authored icon URLs.
 */
export function AuthoredIcon({ icon, className }: { icon?: string; className?: string }) {
  if (!icon) return null;
  if (hasIcon(icon)) return <PageIcon name={icon} className={className} />;
  if (!EMOJI.test(icon)) return null;
  return (
    <span className="inline-grid place-items-center leading-none" aria-hidden>
      {icon}
    </span>
  );
}
