import type * as React from "react"

import { cn } from "../../lib/utils"

const BAR_TONE = {
  primary: "border-primary bg-primary",
  warning: "border-warning bg-warning",
  danger: "border-destructive bg-destructive",
} as const

/**
 * A thin bar for "how much of a limit is used". What is drawn and what is
 * announced are separate on purpose: a caller may draw a small sliver for a
 * tiny non-zero amount (`width`) while assistive tech hears the true value
 * (`value`, `valueText`). The bar is also drawn as a border in its tone, so it
 * survives forced colors, where backgrounds are dropped.
 */
function Meter({
  label,
  value,
  valueText,
  width,
  tone = "primary",
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  /** The accessible name, e.g. "Published pages used". */
  label: string
  /** 0 to 100, as announced. */
  value: number
  /** What a screen reader says, e.g. "40 of 100 (40%)". */
  valueText: string
  /** Drawn width in percent; defaults to `value`. */
  width?: number
  tone?: keyof typeof BAR_TONE
}) {
  const drawn = Math.min(100, Math.max(0, width ?? value))
  return (
    <div
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.min(100, Math.max(0, Math.round(value)))}
      aria-valuetext={valueText}
      className={cn("h-1.5 overflow-hidden rounded-full bg-muted", className)}
      data-slot="meter"
      role="progressbar"
      {...props}
    >
      <div
        className={cn("h-full rounded-full border-y-[3px]", BAR_TONE[tone])}
        data-slot="meter-bar"
        data-tone={tone}
        style={{ width: `${drawn}%` }}
      />
    </div>
  )
}

export { Meter }
