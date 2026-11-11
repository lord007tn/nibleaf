"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"
import { CheckIcon, MinusIcon } from "lucide-react"
import * as React from "react"

import { type DisabledReasonProps, hasContent, joinDescribedBy, useDisabledReason } from "../../lib/disabled-reason"
import { cn } from "../../lib/utils"

const boxClasses =
  "peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input bg-background text-primary-foreground shadow-xs transition-colors outline-none after:absolute after:-inset-2.5 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-checked:border-primary data-checked:bg-primary data-indeterminate:border-primary data-indeterminate:bg-primary dark:bg-input/30 dark:data-checked:bg-primary dark:data-indeterminate:bg-primary data-disabled:cursor-not-allowed data-disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"

/**
 * A checkbox (base-ui): ticked, unticked or `indeterminate` (a "some of
 * these" parent). Space toggles it. Give it a name with a wrapping `<label>`,
 * `aria-label`, or `id` plus `<label htmlFor>`; `CheckboxField` does the
 * label and description for you.
 */
function Checkbox({
  className,
  disabled,
  disabledReason,
  "aria-describedby": describedBy,
  ...props
}: CheckboxPrimitive.Root.Props & DisabledReasonProps) {
  const { controlProps, reason } = useDisabledReason(disabled, disabledReason, describedBy)
  return (
    <>
      <CheckboxPrimitive.Root
        data-slot="checkbox"
        className={cn(boxClasses, className)}
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
      {reason}
    </>
  )
}

type FieldTextProps = {
  /** The visible label; clicking it toggles the control. */
  label: React.ReactNode
  /** A line under the label, read as the control's description. */
  description?: React.ReactNode
}

/**
 * A checkbox with its label and an optional description, laid out as a row:
 * the box on the start side, the text after it (RTL follows the page). The
 * whole row is the click target.
 */
function CheckboxField({
  label,
  description,
  className,
  "aria-describedby": describedBy,
  ...props
}: Omit<React.ComponentProps<typeof Checkbox>, "children"> & FieldTextProps) {
  const descriptionId = React.useId()
  return (
    <label
      data-slot="checkbox-field"
      className={cn(
        "flex cursor-pointer items-start gap-3 text-sm has-data-disabled:cursor-not-allowed has-aria-disabled:cursor-not-allowed",
        className
      )}
    >
      <Checkbox
        {...props}
        className="mt-0.5"
        aria-describedby={joinDescribedBy(describedBy, hasContent(description) ? descriptionId : undefined)}
      />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        {hasContent(description) ? (
          <span id={descriptionId} className="mt-0.5 block text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  )
}

export { Checkbox, CheckboxField }
