import type * as React from "react"

import type { Button } from './button'
import { TooltipButton } from './tooltip-button'

type IconButtonSize = "icon" | "icon-sm" | "icon-xs" | "icon-lg"

/**
 * A button that shows only an icon (operations/ui-overhaul.md §5.5). `label`
 * is required: it is the accessible name and the tooltip shown on hover and
 * focus, so sighted mouse users and screen reader users get the same words.
 * With a `disabledReason` the tooltip shows the reason instead, while the
 * label stays the name.
 */
function IconButton({
  label,
  size = "icon-sm",
  variant = "ghost",
  children,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size" | "aria-label"> & {
  label: string
  size?: IconButtonSize
}) {
  return (
    <TooltipButton size={size} variant={variant} aria-label={label} tooltip={label} {...props}>
      {children}
    </TooltipButton>
  )
}

export { IconButton, type IconButtonSize }
