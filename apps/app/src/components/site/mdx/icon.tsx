import type { CSSProperties } from 'react';
import { PageIcon } from '@/components/site/page-icon';
import { plainCssColor } from './utils';

// ─── Inline icon ──────────────────────────────────────────────────────────────

/** The authored size in pixels, 1 to 128, from its digits and dots (`"24px"` is 24). */
export const iconSize = (size: string | number | undefined): number | undefined => {
  const px = Number(String(size ?? '').replace(/[^0-9.]/g, ''));
  return Number.isFinite(px) && px >= 1 && px <= 128 ? px : undefined;
};

export function Icon({ icon, name, color, size }: { icon?: string; name?: string; color?: string; size?: string | number }) {
  const resolved = icon ?? name;
  if (!resolved) {
    return null;
  }
  const px = iconSize(size);
  const style: CSSProperties = { color: plainCssColor(color) };
  if (px) {
    style.width = px;
    style.height = px;
  }
  return (
    <span className="inline-flex align-text-bottom" style={style}>
      <PageIcon name={resolved} className={px ? 'h-full w-full' : 'size-[1.1em]'} />
    </span>
  );
}
