"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { CheckIcon, MinusIcon } from "lucide-react"
import * as React from "react"

import {
  CONTROL_FOCUS,
  type DisabledReasonProps,
  DisabledReasonText,
  hasContent,
  joinDescribedBy,
  useDisabledReason,
} from "../../lib/disabled-reason"
import { cn } from "../../lib/utils"

// The tick and dash are strokes in the text color, so they stay visible in
// forced colors, where the filled background is dropped.
const boxClasses =
  "peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input bg-background text-primary-foreground shadow-xs transition-colors after:absolute after:-inset-2.5 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-checked:border-primary data-checked:bg-primary data-indeterminate:border-primary data-indeterminate:bg-primary dark:bg-input/30 dark:data-checked:bg-primary dark:data-indeterminate:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"

type CheckboxProps = CheckboxPrimitive.Root.Props & DisabledReasonProps

/** The box, and its disabled reason rendered hidden or (`reasonVisible`) as helper text. */
function useCheckboxControl({
  className,
  disabled,
  disabledReason,
  "aria-describedby": describedBy,
  reasonVisible,
  ...props
}: CheckboxProps & { reasonVisible?: boolean }) {
  const { hasReason, reasonId, controlProps } = useDisabledReason(disabled, disabledReason, describedBy)
  const control = (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(boxClasses, CONTROL_FOCUS, className)}
      disabled={disabled}
      aria-describedby={describedBy}
      {...props}
      {...controlProps}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current"
        render={(indicatorProps, state) => (
          <span {...indicatorProps}>
            {state.indeterminate ? <MinusIcon className="size-3.5" aria-hidden /> : <CheckIcon className="size-3.5" aria-hidden />}
          </span>
        )}
      />
    </CheckboxPrimitive.Root>
  )
  return { control, reason: hasReason ? <DisabledReasonText id={reasonId} visible={reasonVisible}>{disabledReason}</DisabledReasonText> : null }
}

/**
 * A checkbox (base-ui): ticked, unticked or `indeterminate` (a "some of
 * these" parent). Space toggles it. Give it a name with a wrapping `<label>`,
 * `aria-label`, or `id` plus `<label htmlFor>`; `CheckboxField` does the
 * label, description and a visible disabled reason for you.
 */
function Checkbox(props: CheckboxProps) {
  const { control, reason } = useCheckboxControl(props)
  return (
    <>
      {control}
      {reason}
    </>
  )
}

/**
 * A checkbox with its label, an optional description and, when it can't be
 * changed, its reason, as a row: the box on the start side, the text after it
 * (RTL follows the page). The whole row is the click target. The name is the
 * label alone; the description and the reason are its description.
 */
function CheckboxField({
  label,
  description,
  className,
  "aria-describedby": describedBy,
  ...props
}: Omit<CheckboxProps, "children"> & { label: React.ReactNode; description?: React.ReactNode }) {
  const labelId = React.useId()
  const descriptionId = React.useId()
  const hasDescription = hasContent(description)
  const { control, reason } = useCheckboxControl({
    ...props,
    className: "mt-0.5",
    "aria-labelledby": labelId,
    "aria-describedby": joinDescribedBy(describedBy, hasDescription ? descriptionId : undefined),
    reasonVisible: true,
  })
  return (
    <label
      data-slot="checkbox-field"
      className={cn(
        "flex cursor-pointer items-start gap-3 text-sm has-data-disabled:cursor-not-allowed has-aria-disabled:cursor-not-allowed",
        className
      )}
    >
      {control}
      <span className="min-w-0 flex-1">
        <span id={labelId} className="block font-medium">
          {label}
        </span>
        {hasDescription ? (
          <span id={descriptionId} className="mt-0.5 block text-muted-foreground">
            {description}
          </span>
        ) : null}
        {reason}
      </span>
    </label>
  )
}

export { Checkbox, CheckboxField }
