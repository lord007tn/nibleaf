import { type CalloutType, normalizeType } from '@nibleaf/shared/callouts';
import { AlertTriangle, Check, Info, Lightbulb, type LucideIcon, OctagonAlert } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { AuthoredIcon, isDrawableIcon } from './authored-icon';
import { Callout } from './callout';
import { authoredColor } from './utils';

// Mirrors callout.tsx, which stays minimal because every public page loads it.
const TYPE_LOOK: Record<CalloutType, { icon: LucideIcon; token: string }> = {
  note: { icon: Info, token: 'var(--theme-info,var(--primary))' },
  info: { icon: Info, token: 'var(--theme-info,var(--primary))' },
  tip: { icon: Lightbulb, token: 'var(--theme-success,var(--primary))' },
  check: { icon: Check, token: 'var(--theme-success,var(--primary))' },
  warning: { icon: AlertTriangle, token: 'var(--theme-warning,var(--primary))' },
  danger: { icon: OctagonAlert, token: 'var(--theme-danger,var(--destructive))' },
};

/**
 * `<Callout icon="…" color="#…">`: Mintlify's custom callout. Without a custom
 * look it is the ordinary typed callout. It lives in the lazy renderer chunk
 * because only authored tags (never `> [!NOTE]`) can carry these props.
 */
export function CustomCallout({ type, icon, color, children }: { type?: string; icon?: string; color?: string; children?: ReactNode }) {
  const tone = authoredColor(color);
  const drawable = isDrawableIcon(icon);
  if (!tone && !drawable) return <Callout type={type}>{children}</Callout>;
  const look = TYPE_LOOK[normalizeType(type)];
  const token = tone ?? look.token;
  const TypeIcon = look.icon;
  return (
    <div
      className="my-5 flex gap-3 rounded-xl border p-4 text-foreground"
      data-theme-component="callout"
      role="note"
      style={
        {
          '--callout-color': token,
          '--callout-border': `color-mix(in oklab,${token} 38%,transparent)`,
          '--callout-bg': `color-mix(in oklab,${token} 10%,transparent)`,
        } as CSSProperties
      }
    >
      {drawable ? (
        <span className="mt-0.5 inline-flex size-5 shrink-0 text-(--callout-color)" aria-hidden>
          <AuthoredIcon icon={icon} className="size-5" />
        </span>
      ) : (
        <TypeIcon className="mt-0.5 size-5 shrink-0" aria-hidden />
      )}
      <div className="min-w-0 flex-1 [&>:first-child]:mt-0 [&>:last-child]:mb-0">{children}</div>
    </div>
  );
}
