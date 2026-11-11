import { type CalloutType, normalizeType } from '@nibleaf/shared/callouts';
import { AlertTriangle, Check, Info, Lightbulb, type LucideIcon, OctagonAlert } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

// ─── Callouts / admonitions ─────────────────────────────────────────────────

const CALLOUT: Record<CalloutType, { icon: LucideIcon; token: string }> = {
  note: { icon: Info, token: 'var(--theme-info,var(--primary))' },
  info: { icon: Info, token: 'var(--theme-info,var(--primary))' },
  tip: { icon: Lightbulb, token: 'var(--theme-success,var(--primary))' },
  check: { icon: Check, token: 'var(--theme-success,var(--primary))' },
  warning: { icon: AlertTriangle, token: 'var(--theme-warning,var(--primary))' },
  danger: { icon: OctagonAlert, token: 'var(--theme-danger,var(--destructive))' },
};

/** `dir` (from rehypeBlockDirection) puts the icon on the side the callout's own text starts. */
export function Callout({ type, dir, children }: { type?: string; dir?: string; children?: ReactNode }) {
  const meta = CALLOUT[normalizeType(type)];
  const Icon = meta.icon;
  return (
    <div
      className="my-5 flex gap-3 rounded-xl border p-4 text-foreground"
      data-theme-component="callout"
      dir={dir}
      role="note"
      style={
        {
          '--callout-color': meta.token,
          '--callout-border': `color-mix(in oklab,${meta.token} 38%,transparent)`,
          '--callout-bg': `color-mix(in oklab,${meta.token} 10%,transparent)`,
        } as CSSProperties
      }
    >
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1 [&>:first-child]:mt-0 [&>:last-child]:mb-0">{children}</div>
    </div>
  );
}
