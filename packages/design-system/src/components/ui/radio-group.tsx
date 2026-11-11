"use client"

import { Radio as RadioPrimitive } from "@base-ui/react/radio"
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group"
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

/**
 * Lets items tell their group about the reasons they can't be chosen: arrow
 * keys pass over an unavailable item, so its reason is also part of the
 * group's description, read when focus enters the group.
 */
const ReasonRegistry = React.createContext<((id: string) => () => void) | null>(null)

function useRegisterReason(id: string, active: boolean) {
  const register = React.useContext(ReasonRegistry)
  React.useEffect(() => (active && register ? register(id) : undefined), [active, id, register])
}

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
 * it is announced as unavailable and is never chosen. Arrow keys pass over
 * both kinds, as they do over any unavailable choice, so each reason is also
 * part of the group's description; `RadioField` shows it under the label too.
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
  const [reasonIds, setReasonIds] = React.useState<readonly string[]>([])
  const register = React.useCallback((id: string) => {
    setReasonIds((ids) => (ids.includes(id) ? ids : [...ids, id]))
    return () => setReasonIds((ids) => ids.filter((item) => item !== id))
  }, [])
  return (
    <ReasonRegistry.Provider value={register}>
      <RadioGroupPrimitive
        data-slot="radio-group"
        className={cn("flex flex-col gap-3", className)}
        aria-labelledby={joinDescribedBy(labelledBy, hasLabel ? labelId : undefined)}
        aria-describedby={joinDescribedBy(describedBy, hasDescription ? descriptionId : undefined, ...reasonIds)}
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
    </ReasonRegistry.Provider>
  )
}

type RadioItemProps = RadioPrimitive.Root.Props & DisabledReasonProps

/** The radio button, and its disabled reason rendered hidden or (`reasonVisible`) as helper text. */
function useRadioControl({
  className,
  disabled,
  disabledReason,
  "aria-describedby": describedBy,
  reasonVisible,
  ...props
}: RadioItemProps & { reasonVisible?: boolean }) {
  const { hasReason, reasonId, controlProps } = useDisabledReason(disabled, disabledReason, describedBy)
  useRegisterReason(reasonId, hasReason)
  const control = (
    <RadioPrimitive.Root
      data-slot="radio-group-item"
      className={cn(
        "peer relative flex aspect-square size-4 shrink-0 items-center justify-center rounded-full border border-input bg-background shadow-xs transition-colors after:absolute after:-inset-2.5 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-checked:border-primary dark:bg-input/30 data-disabled:cursor-not-allowed data-disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50",
        CONTROL_FOCUS,
        className
      )}
      disabled={disabled}
      aria-describedby={describedBy}
      {...props}
      {...controlProps}
    >
      {/* A dot drawn as a border, not a background, so forced colors keep it (in the system color). */}
      <RadioPrimitive.Indicator data-slot="radio-group-indicator" className="size-2 rounded-full border-4 border-primary" />
    </RadioPrimitive.Root>
  )
  return { control, reason: hasReason ? <DisabledReasonText id={reasonId} visible={reasonVisible}>{disabledReason}</DisabledReasonText> : null }
}

/** A single radio button. Give it a name with a wrapping `<label>` or `aria-label`; `RadioField` does that for you. */
function RadioGroupItem(props: RadioItemProps) {
  const { control, reason } = useRadioControl(props)
  return (
    <>
      {control}
      {reason}
    </>
  )
}

/**
 * A radio button with its label, an optional description and, when it can't
 * be chosen, its reason, as a row: the button on the start side, the text
 * after it. The whole row is the click target. The name is the label alone.
 */
function RadioField({
  label,
  description,
  className,
  "aria-describedby": describedBy,
  ...props
}: Omit<RadioItemProps, "children"> & { label: React.ReactNode; description?: React.ReactNode }) {
  const labelId = React.useId()
  const descriptionId = React.useId()
  const hasDescription = hasContent(description)
  const { control, reason } = useRadioControl({
    ...props,
    className: "mt-0.5",
    "aria-labelledby": labelId,
    "aria-describedby": joinDescribedBy(describedBy, hasDescription ? descriptionId : undefined),
    reasonVisible: true,
  })
  return (
    <label
      data-slot="radio-field"
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

export { RadioField, RadioGroup, RadioGroupItem }
