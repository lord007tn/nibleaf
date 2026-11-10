import * as React from "react"

import { cn } from '../../lib/utils'

/**
 * How wide the control column is once the row has room for two columns
 * (operations/ui-overhaul.md §5.2). Below that the row stacks and controls go
 * full width, except switches, which stay their own size on the label line.
 */
type SettingsRowControl = "switch" | "compact" | "field" | "auto"

/**
 * The ids a row hands to its control. Spread `controlProps` on a single
 * control; a group (`asGroup`) is described by the row itself, so its controls
 * only need their own labels.
 */
interface SettingsRowIds {
  controlId: string
  labelId: string
  descriptionId?: string
  reasonId?: string
  errorId?: string
  /** description, then disabled reason, then error: the order a reader hears them. */
  describedBy?: string
  controlProps: { id?: string; "aria-describedby"?: string; "aria-invalid"?: true }
}

const CONTROL_WIDTH: Record<SettingsRowControl, string> = {
  switch: "justify-self-end",
  compact: "w-full @min-[35rem]/row:w-48",
  field: "w-full @min-[35rem]/row:w-72",
  auto: "w-full @min-[35rem]/row:w-auto @min-[35rem]/row:max-w-[50cqw]",
}

/** Joins id lists for `aria-describedby`, dropping blanks and duplicates. */
function describedBy(...ids: Array<string | undefined | null | false>): string | undefined {
  const unique = [...new Set(ids.flatMap((id) => (id ? id.split(/\s+/) : [])).filter(Boolean))]
  return unique.length ? unique.join(" ") : undefined
}

/**
 * One setting: its label and description at the start, its control at the end
 * (`layout="inline"`), or the control under them at full width
 * (`layout="stacked"`, for textareas, lists and multi-field groups).
 *
 * The row lays itself out from its own width (a container query), not the
 * viewport's, because the same rows render in the 760px settings column and in
 * narrower editor panels.
 *
 * Labelling is by composition, never by inspecting children: pass a render
 * function and spread `ids.controlProps` on the control, or pass `htmlFor` and
 * wire the control yourself. `asGroup` labels a set of controls (radios,
 * a segmented control, a date range) with `role="group"`.
 *
 * `disabledReason` is shown as visible text under the description, so touch
 * users see it too, and joins the control's description. `error` renders under
 * the control; an app form adapter passes its own `errorId`.
 */
function SettingsRow({
  label,
  description,
  layout = "inline",
  control = "auto",
  asGroup = false,
  htmlFor,
  disabledReason,
  error,
  errorId: errorIdProp,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  label: React.ReactNode
  description?: React.ReactNode
  layout?: "inline" | "stacked"
  control?: SettingsRowControl
  asGroup?: boolean
  /** The control's id when you render it yourself; otherwise one is generated. */
  htmlFor?: string
  disabledReason?: React.ReactNode
  error?: React.ReactNode
  errorId?: string
  children: React.ReactNode | ((ids: SettingsRowIds) => React.ReactNode)
}) {
  const base = React.useId()
  const labelId = `${base}-label`
  const controlId = htmlFor ?? `${base}-control`
  const descriptionId = description ? `${base}-description` : undefined
  const reasonId = disabledReason ? `${base}-reason` : undefined
  const errorId = error ? (errorIdProp ?? `${base}-error`) : undefined
  const describedByIds = describedBy(descriptionId, reasonId, errorId)
  const ids: SettingsRowIds = {
    controlId,
    labelId,
    descriptionId,
    reasonId,
    errorId,
    describedBy: describedByIds,
    controlProps: asGroup
      ? {}
      : {
          id: controlId,
          "aria-describedby": describedByIds,
          ...(errorId ? { "aria-invalid": true as const } : {}),
        },
  }
  const inline = layout === "inline"
  // Switches never stack: a full-width switch reads as a broken control.
  const alwaysTwoColumns = inline && control === "switch"
  const labelClass = "block break-words font-medium text-sm"

  return (
    <div
      data-slot="settings-row"
      data-layout={layout}
      data-disabled={disabledReason ? "" : undefined}
      role={asGroup ? "group" : undefined}
      aria-labelledby={asGroup ? labelId : undefined}
      aria-describedby={asGroup ? describedByIds : undefined}
      className={cn("@container/row min-w-0 px-4 py-4 sm:px-5", className)}
      {...props}
    >
      <div
        className={cn(
          "grid min-w-0 gap-x-6 gap-y-3",
          alwaysTwoColumns && "grid-cols-[minmax(0,1fr)_auto] items-center",
          inline && !alwaysTwoColumns && "@min-[35rem]/row:grid-cols-[minmax(0,1fr)_auto] @min-[35rem]/row:items-center"
        )}
      >
        <div className="min-w-0">
          {asGroup ? (
            <div id={labelId} className={labelClass}>
              {label}
            </div>
          ) : (
            <label id={labelId} htmlFor={controlId} className={labelClass}>
              {label}
            </label>
          )}
          {description ? (
            <p id={descriptionId} className="mt-1 break-words text-muted-foreground text-sm">
              {description}
            </p>
          ) : null}
          {disabledReason ? (
            <p id={reasonId} data-slot="settings-row-reason" className="mt-1 break-words text-muted-foreground text-sm">
              {disabledReason}
            </p>
          ) : null}
        </div>
        <div className={cn("min-w-0", inline ? CONTROL_WIDTH[control] : "w-full")}>
          {typeof children === "function" ? children(ids) : children}
          {error ? (
            <p id={errorId} data-slot="settings-row-error" className="mt-1.5 break-words text-destructive text-xs">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export { SettingsRow, describedBy, type SettingsRowControl, type SettingsRowIds }
