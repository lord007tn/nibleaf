import type * as React from "react"

import { Button } from "./button"
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip"

/**
 * A Button with a tooltip anchored on the button itself (no wrapper, nothing
 * nested in it), shown on hover and focus. A `disabledReason` replaces the
 * tooltip while set, so a disabled button explains itself on hover too
 * (operations/ui-overhaul.md §6.5); the reason is also the button's
 * description for assistive tech, as on Button.
 *
 * Dashboard-only: it lives apart from Button so published docs pages, which
 * use Button, never load tooltip code.
 */
function TooltipButton({
  tooltip,
  disabledReason,
  loading,
  ...props
}: React.ComponentProps<typeof Button> & { tooltip?: React.ReactNode }) {
  const reason = loading ? undefined : disabledReason
  const content = reason != null && reason !== false && reason !== "" ? reason : tooltip
  const button = <Button disabledReason={disabledReason} loading={loading} {...props} />
  const hasContent = content != null && content !== false && content !== ""
  // Always the same tree, with the tooltip's popup only when there is something
  // to say: a reason or tooltip that comes and goes must not remount the button
  // (a focused button would lose focus to the page).
  return (
    <Tooltip>
      <TooltipTrigger render={button} />
      {hasContent ? <TooltipContent>{content}</TooltipContent> : null}
    </Tooltip>
  )
}

export { TooltipButton }
