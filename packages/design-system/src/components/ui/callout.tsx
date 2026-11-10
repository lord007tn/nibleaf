import * as React from "react"
import { CircleCheckIcon, InfoIcon, OctagonAlertIcon, TriangleAlertIcon } from "lucide-react"

import { cn } from '../../lib/utils'
import { Alert, AlertDescription, AlertTitle } from "./alert"

type CalloutTone = "neutral" | "info" | "success" | "warning" | "danger"

const VARIANT = {
  neutral: "default",
  info: "info",
  success: "success",
  warning: "warning",
  danger: "destructive",
} as const satisfies Record<CalloutTone, string>

const ICON: Record<CalloutTone, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  neutral: InfoIcon,
  info: InfoIcon,
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
  danger: OctagonAlertIcon,
}

/**
 * The live role a callout gets unless one is passed: `status` (polite) for
 * neutral, info and success; none for warning and danger, which are usually
 * rendered with the page and shouldn't interrupt; `alert` only when `urgent`.
 */
function calloutRole(tone: CalloutTone, urgent: boolean): React.AriaRole | undefined {
  if (urgent) return "alert"
  return tone === "warning" || tone === "danger" ? undefined : "status"
}

/**
 * An inline note inside a page or section (operations/ui-overhaul.md §6),
 * built on `Alert`. Unlike `Alert`, it is not `role="alert"` by default; pass
 * `urgent` for something that must interrupt, or an explicit `role`.
 *
 * `action` sits at the end and wraps under the text on narrow widths.
 * `icon` replaces the tone's default icon; pass `null` for none. A custom icon
 * should be an svg element so it lines up in the alert's icon column.
 */
function Callout({
  tone = "neutral",
  title,
  action,
  icon,
  urgent = false,
  role,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  tone?: CalloutTone
  title?: React.ReactNode
  /** Buttons or a link rendered at the end. */
  action?: React.ReactNode
  icon?: React.ReactNode
  /** Announce assertively (`role="alert"`). Use for errors that block the task. */
  urgent?: boolean
}) {
  const Icon = ICON[tone]
  return (
    <Alert
      variant={VARIANT[tone]}
      data-slot="callout"
      data-tone={tone}
      className={cn(tone === "danger" && "border-destructive/30 bg-destructive/10", className)}
      {...props}
      // Alert hard-codes role="alert" and spreads props after it, so this key
      // (even when undefined) replaces it.
      role={role !== undefined ? role : calloutRole(tone, urgent)}
    >
      {icon === undefined ? <Icon aria-hidden="true" /> : icon}
      <div className="flex min-w-0 flex-wrap items-start gap-x-4 gap-y-2 group-has-[>svg]/alert:col-start-2">
        <div className="min-w-0 flex-1 basis-64">
          {title ? <AlertTitle className="break-words">{title}</AlertTitle> : null}
          {children ? <AlertDescription className="break-words">{children}</AlertDescription> : null}
        </div>
        {action ? (
          <div data-slot="callout-action" className="ms-auto flex shrink-0 flex-wrap items-center gap-2">
            {action}
          </div>
        ) : null}
      </div>
    </Alert>
  )
}

export { Callout, type CalloutTone }
