import type { CSSProperties } from 'react';
import { z } from 'zod';
import { PageIcon } from '@/components/site/page-icon';

// ─── Inline icon ──────────────────────────────────────────────────────────────

export function Icon({ icon, name, color, size }: { icon?: string; name?: string; color?: string; size?: string | number }) {
  const resolved = icon ?? name;
  if (!resolved) {
    return null;
  }
  const parsedSize = z.coerce
    .number()
    .min(1)
    .max(128)
    .safeParse(String(size ?? '').replace(/[^0-9.]/g, ''));
  const px = parsedSize.success ? parsedSize.data : undefined;
  const style: CSSProperties = { color };
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
