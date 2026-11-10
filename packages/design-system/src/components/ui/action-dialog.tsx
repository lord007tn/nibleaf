"use client"

import * as React from "react"
import type { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from '../../lib/utils'
import { Button } from './button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './dialog'
import { Input } from './input'
import { Label } from './label'
import { restoreFocusFallback } from '../../lib/focus'

/** Typed confirmation compares what a person sees: no edge spaces, one Unicode form, same case. */
const normalizeTyped = (value: string) => value.trim().normalize("NFC")

type TypedConfirmationProps =
  | { confirmText?: undefined; confirmTextLabel?: undefined; confirmTextMismatch?: undefined }
  | {
      /** The text the person must type to confirm (e.g. the site's slug). */
      confirmText: string
      /** The input's label, e.g. "Type docs to confirm". */
      confirmTextLabel: React.ReactNode
      /** Shown under the input when Confirm is pressed and the text doesn't match. */
      confirmTextMismatch: React.ReactNode
    }

type ActionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  /** Extra body content between the description and the actions. */
  children?: React.ReactNode
  confirmLabel: React.ReactNode
  cancelLabel: React.ReactNode
  /** Replaces the confirm label while the action runs (e.g. "Deleting…"). */
  pendingLabel?: string
  destructive?: boolean
  /** The action. Resolve to close the dialog; reject to keep it open and show the error. */
  onConfirm: () => Promise<void>
  /**
   * Turns a rejection into friendly copy shown inside the dialog. Without it
   * an `Error`'s own message is shown.
   */
  errorMessage?: (error: unknown) => React.ReactNode
  /** Overrides where focus returns on close (defaults to the trigger, else the page h1). */
  finalFocus?: DialogPrimitive.Popup.Props["finalFocus"]
  className?: string
} & TypedConfirmationProps

/**
 * A dialog that runs an action itself (operations/ui-overhaul.md §6.3), as
 * opposed to `useConfirm`, which only asks.
 *
 * While the action runs the confirm button shows `loading`, a second confirm
 * is ignored, and Escape, outside clicks and Cancel can't close the dialog. On
 * success it closes; on failure it stays open with the error inside it, so the
 * person can retry or cancel. Callers mark the mutation with
 * `meta: { suppressGlobalError: true }` so the error isn't also toasted.
 *
 * With `confirmText` the person types it to confirm. The button stays enabled;
 * pressing it with a mismatch shows the field error and focuses the field.
 */
function ActionDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel,
  pendingLabel,
  destructive = false,
  onConfirm,
  errorMessage,
  finalFocus,
  className,
  confirmText,
  confirmTextLabel,
  confirmTextMismatch,
}: ActionDialogProps) {
  const id = React.useId()
  const inputId = `${id}-confirm-text`
  const mismatchId = `${id}-confirm-text-error`
  const [pending, setPending] = React.useState(false)
  const pendingRef = React.useRef(false)
  const mountedRef = React.useRef(true)
  const [failure, setFailure] = React.useState<{ error: unknown } | null>(null)
  const [typed, setTyped] = React.useState("")
  const [typedAttempted, setTypedAttempted] = React.useState(false)
  const [wasOpen, setWasOpen] = React.useState(false)
  const returnFocus = React.useRef<HTMLElement | null>(null)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Each opening starts clean, and remembers what had focus before the dialog
  // takes it (read here, during the render that opens it, because the popup
  // moves focus before any of this component's effects run).
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setFailure(null)
      setTyped("")
      setTypedAttempted(false)
    }
  }

  // Opening focus: the field when typing is required, Cancel for destructive
  // actions, else the action itself.
  const focusOnOpen = confirmText !== undefined ? "input" : destructive ? "cancel" : "confirm"
  const typedMatches = confirmText === undefined || normalizeTyped(typed) === normalizeTyped(confirmText)
  const showMismatch = typedAttempted && !typedMatches

  const requestOpenChange = (next: boolean) => {
    // Nothing closes the dialog while the action runs.
    if (!next && pendingRef.current) return
    onOpenChange(next)
  }

  const runConfirm = async () => {
    if (pendingRef.current) return
    if (!typedMatches) {
      setTypedAttempted(true)
      inputRef.current?.focus()
      return
    }
    pendingRef.current = true
    setPending(true)
    setFailure(null)
    try {
      await onConfirm()
      pendingRef.current = false
      if (!mountedRef.current) return
      setPending(false)
      onOpenChange(false)
    } catch (error) {
      pendingRef.current = false
      if (!mountedRef.current) return
      setPending(false)
      setFailure({ error })
    }
  }

  const failureContent = failure
    ? errorMessage
      ? errorMessage(failure.error)
      : failure.error instanceof Error
        ? failure.error.message
        : null
    : null

  return (
    <Dialog open={open} onOpenChange={requestOpenChange} disablePointerDismissal={pending}>
      <DialogContent
        data-slot="action-dialog"
        className={cn("max-w-sm", className)}
        showCloseButton={false}
        aria-busy={pending || undefined}
        finalFocus={finalFocus ?? (() => restoreFocusFallback(returnFocus.current))}
      >
        <form
          noValidate
          className="grid min-w-0 gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void runConfirm()
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          {children}
          {confirmText !== undefined ? (
            <div className="flex min-w-0 flex-col gap-1.5">
              <Label htmlFor={inputId} className="block break-words leading-normal">
                {confirmTextLabel}
              </Label>
              <Input
                ref={inputRef}
                autoFocus={focusOnOpen === "input"}
                id={inputId}
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                readOnly={pending}
                dir="auto"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={showMismatch || undefined}
                aria-describedby={showMismatch ? mismatchId : undefined}
              />
              {showMismatch ? (
                <p id={mismatchId} data-slot="action-dialog-mismatch" className="break-words text-destructive text-xs">
                  {confirmTextMismatch}
                </p>
              ) : null}
            </div>
          ) : null}
          {failureContent ? (
            <div
              role="alert"
              data-slot="action-dialog-error"
              className="break-words rounded-md bg-destructive/10 px-3 py-2 text-destructive text-sm"
            >
              {failureContent}
            </div>
          ) : null}
          <DialogFooter>
            {/* Both stay focusable while pending, so focus isn't dropped to the body. */}
            <Button
              autoFocus={focusOnOpen === "cancel"}
              type="button"
              variant="outline"
              disabled={pending}
              focusableWhenDisabled
              onClick={() => requestOpenChange(false)}
            >
              {cancelLabel}
            </Button>
            <Button
              autoFocus={focusOnOpen === "confirm"}
              type="submit"
              variant={destructive ? "destructive" : "default"}
              loading={pending}
              loadingText={pendingLabel}
              focusableWhenDisabled
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export { ActionDialog, type ActionDialogProps }
