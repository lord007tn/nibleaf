"use client"

import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"
import * as React from "react"

import { type DisabledReasonProps, hasContent, joinDescribedBy, useDisabledReason } from "../../lib/disabled-reason"
import { cn } from "../../lib/utils"

type GroupTextProps = {
  /** The group's visible name, read as its label (otherwise pass `aria-label` or `aria-labelledby`). */
  label?: React.ReactNode
  /** A line under the label, read as the group's description. */
  description?: React.ReactNode
}

/**
 * One choice among several (base-ui). Tab moves into the group once, on the
 * chosen item; arrow keys move and choose, following the reading direction in
 * RTL (wrap it in a `DirectionProvider`, as the app shell does). An item that
 * can't be chosen right now is `disabled`, or, better, has a `disabledReason`:
 * it is announced as unavailable with its reason and is never chosen. Arrow
 * keys pass over both kinds, as they do over any unavailable choice.
 */
function RadioGroup({
  className,
  label,
  description,
  children,
  "aria-labelledby": labelledBy,
  "aria-describedby": describedBy,
  ...props
}: RadioGroupPrimitive.Props & GroupTextProps) {
  const labelId = React.useId()
  const descriptionId = React.useId()
  const hasLabel = hasContent(label)
  const hasDescription = hasContent(description)
  return (
    <RadioGroupPrimitive
      data-slot="radio-group"
      className={cn("flex flex-col gap-3", className)}
      aria-labelledby={joinDescribedBy(labelledBy, hasLabel ? labelId : undefined)}
      aria-describedby={joinDescribedBy(describedBy, hasDescription ? descriptionId : undefined)}
      {...props}
    >
      {hasLabel || hasDescription ? (
        <div className="flex flex-col gap-0.5">
          {hasLabel ? (
            <span id={labelId} className="font-medium text-sm">
              {label}
            </span>
          ) : null}
          {hasDescription ? (
            <span id={descriptionId} className="text-muted-foreground text-sm">
              {description}
            </span>
          ) : null}
        </div>
      ) : null}
      {children}
    </RadioGroupPrimitive>
  )
}

/** A single radio button. Give it a name with a wrapping `<label>` or `aria-label`; `RadioField` does that for you. */
function RadioGroupItem({
  className,
  disabled,
  disabledReason,
  "aria-describedby": describedBy,
  ...props
}: RadioPrimitive.Root.Props & DisabledReasonProps) {
  const { controlProps, reason } = useDisabledReason(disabled, disabledReason, describedBy)
  return (
    <>
      <RadioPrimitive.Root
        data-slot="radio-group-item"
        className={cn(
          "peer relative flex aspect-square size-4 shrink-0 items-center justify-center rounded-full border border-input bg-background shadow-xs transition-colors outline-none after:absolute after:-inset-2.5 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-checked:border-primary dark:bg-input/30 data-disabled:cursor-not-allowed data-disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
          className
        )}
        disabled={disabled}
        aria-describedby={describedBy}
        {...props}
        {...controlProps}
      >
        <RadioPrimitive.Indicator data-slot="radio-group-indicator" className="size-2 rounded-full bg-primary" />
      </RadioPrimitive.Root>
      {reason}
    </>
  )
}

/**
 * A radio button with its label and an optional description, as a row: the
 * button on the start side, the text after it. The whole row is the click
 * target.
 */
function RadioField({
  label,
  description,
  className,
  "aria-describedby": describedBy,
  ...props
}: Omit<React.ComponentProps<typeof RadioGroupItem>, "children"> & { label: React.ReactNode; description?: React.ReactNode }) {
  const descriptionId = React.useId()
  const hasDescription = hasContent(description)
  return (
    <label
      data-slot="radio-field"
      className={cn(
        "flex cursor-pointer items-start gap-3 text-sm has-data-disabled:cursor-not-allowed has-aria-disabled:cursor-not-allowed",
        className
      )}
    >
      <RadioGroupItem
        {...props}
        className="mt-0.5"
        aria-describedby={joinDescribedBy(describedBy, hasDescription ? descriptionId : undefined)}
      />
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        {hasDescription ? (
          <span id={descriptionId} className="mt-0.5 block text-muted-foreground">
            {description}
          </span>
        ) : null}
      </span>
    </label>
  )
}

export { RadioField, RadioGroup, RadioGroupItem }
