"use client"

import * as React from "react"
import { CheckIcon, CopyIcon } from "lucide-react"

import { Button } from "./button"
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip"

/** How long the check mark and the announcement stay after a copy. */
const RESET_MS = 2000

type CopyState = "idle" | "copied" | "failed"

/**
 * Copies `value` to the clipboard (operations/ui-overhaul.md §6). The icon
 * turns into a check for two seconds and `copiedLabel` is announced through a
 * polite live region that is in the DOM from the first render, so screen
 * readers pick up the change. A failed copy announces `failedLabel`.
 *
 * Icon-only by default: `label` is the accessible name and the tooltip. Pass
 * `children` for a text button; the visible text is then its name.
 */
function CopyButton({
  value,
  label,
  copiedLabel,
  failedLabel,
  variant = "ghost",
  size,
  children,
  onClick,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "value" | "children"> & {
  value: string
  /** Accessible name and tooltip, e.g. "Copy domain". */
  label: string
  /** Announced after a successful copy, e.g. "Copied". */
  copiedLabel: string
  /** Announced when the clipboard refuses the write; silent when omitted. */
  failedLabel?: string
  children?: React.ReactNode
}) {
  const [state, setState] = React.useState<CopyState>("idle")
  const timer = React.useRef<ReturnType<typeof setTimeout>>(undefined)

  React.useEffect(() => () => clearTimeout(timer.current), [])

  const settle = (next: CopyState) => {
    setState(next)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState("idle"), RESET_MS)
  }

  const copy = async () => {
    // Clear first, so copying twice in a row is announced twice.
    clearTimeout(timer.current)
    setState("idle")
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable")
      await navigator.clipboard.writeText(value)
      settle("copied")
    } catch {
      settle("failed")
    }
  }

  const iconOnly = children === undefined || children === null
  const Icon = state === "copied" ? CheckIcon : CopyIcon
  const announcement = state === "copied" ? copiedLabel : state === "failed" ? (failedLabel ?? "") : ""

  const button = (
    <Button
      type="button"
      variant={variant}
      size={size ?? (iconOnly ? "icon-sm" : "sm")}
      aria-label={iconOnly ? label : undefined}
      data-slot="copy-button"
      data-state={state}
      onClick={(event) => {
        onClick?.(event)
        void copy()
      }}
      {...props}
    >
      <Icon aria-hidden="true" data-icon={iconOnly ? undefined : "inline-start"} />
      {children}
    </Button>
  )

  return (
    <>
      {iconOnly ? (
        <Tooltip>
          <TooltipTrigger render={button} />
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      ) : (
        button
      )}
      <span role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </span>
    </>
  )
}

export { CopyButton }
