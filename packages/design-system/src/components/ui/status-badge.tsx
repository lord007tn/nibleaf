import type * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from '../../lib/utils'
import { Badge } from "./badge"

/**
 * Surface and text per tone. Text uses the tone token on a 10% tint of itself,
 * the same pairing as `alert.tsx`, so it keeps contrast in light and dark.
 */
const statusBadgeVariants = cva("max-w-full gap-1.5", {
  variants: {
    tone: {
      neutral: "border-border bg-muted text-foreground",
      info: "border-info/30 bg-info/10 text-info",
      success: "border-success/30 bg-success/10 text-success",
      warning: "border-warning/30 bg-warning/10 text-warning",
      danger: "border-destructive/30 bg-destructive/10 text-destructive",
      pending: "border-border bg-muted text-foreground",
    },
    size: {
      default: "",
      sm: "h-4 gap-1 px-1.5 py-0 text-[0.6875rem]",
    },
  },
  defaultVariants: {
    tone: "neutral",
    size: "default",
  },
})

const DOT_TONE: Record<StatusBadgeTone, string> = {
  neutral: "bg-muted-foreground",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  // Pulses to read as "in progress"; still under reduced motion.
  pending: "bg-info motion-safe:animate-pulse",
}

type StatusBadgeTone = NonNullable<VariantProps<typeof statusBadgeVariants>["tone"]>

/**
 * A short status next to a name or in a row: a dot coloured by tone and a
 * label (operations/ui-overhaul.md §6). The label is required, so the status
 * never depends on colour alone. `icon` replaces the dot.
 */
function StatusBadge({
  tone = "neutral",
  size = "default",
  icon,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"span">, "children"> & {
  tone?: StatusBadgeTone
  size?: "sm" | "default"
  /** Replaces the dot, e.g. a lucide icon. Hidden from assistive tech. */
  icon?: React.ReactNode
  /** The status in words, e.g. "Active". */
  children: React.ReactNode
}) {
  return (
    <Badge
      variant="outline"
      data-slot="status-badge"
      data-tone={tone}
      className={cn(statusBadgeVariants({ tone, size }), className)}
      {...props}
    >
      {icon ? (
        <span aria-hidden="true" data-slot="status-badge-icon" className="inline-flex shrink-0 [&>svg]:size-3">
          {icon}
        </span>
      ) : (
        <span
          aria-hidden="true"
          data-slot="status-badge-dot"
          className={cn("shrink-0 rounded-full", size === "sm" ? "size-1.5" : "size-2", DOT_TONE[tone])}
        />
      )}
      <span className="min-w-0 truncate">{children}</span>
    </Badge>
  )
}

export { StatusBadge, statusBadgeVariants, type StatusBadgeTone }
