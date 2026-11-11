"use client"

import * as React from "react"
import type { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from '../../lib/utils'
import { Button } from './button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './dialog'
import { Input } from './input'
import { Label } from './label'
import { currentFocusTarget, restoreFocusFallback } from '../../lib/focus'

const hasContent = (node: React.ReactNode) =>
  node != null && node !== false && !(typeof node === "string" && node.trim() === "")

/**
 * Invisible direction marks (Unicode Bidi_Control: LRM, RLM, ALM, the embedding
 * and override marks, and the isolates). A stored name can carry one that the
 * person can't see or type, so they never decide a match.
 */
const BIDI_CONTROLS = /[؜‎‏‪-‮⁦-⁩]/g

/**
 * Typed confirmation compares what a person sees: no direction marks, no edge
 * spaces, one Unicode form, same case. Letters and combining marks (Arabic
 * harakat included) still count.
 */
const normalizeTyped = (value: string) => value.replace(BIDI_CONTROLS, "").trim().normalize("NFC")

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
   * Turns a rejection into friendly copy shown inside the dialog. Return
   * nothing to fall back to `fallbackErrorMessage`.
   */
  errorMessage?: (error: unknown) => React.ReactNode
  /**
   * Shown when the action fails and `errorMessage` gives nothing usable, e.g.
   * "Couldn't delete the site. Try again." Required so no rejection, whatever
   * its shape, ever fails silently. Raw error text is never shown.
   */
  fallbackErrorMessage: React.ReactNode
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
 * With `confirmText` the person types it to confirm. Confirm stays disabled
 * (focusable, announced as unavailable with the field's label as its reason)
 * until the typed text matches; a non-empty mismatch shows the field error as
 * they type, and Enter with a mismatch focuses the field.
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
  fallbackErrorMessage,
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
  // Bumped on every open and close. An action remembers the generation it
  // started in; if the dialog has closed or reopened since, its result
  // belongs to a dialog that no longer exists and is ignored.
  const generationRef = React.useRef(0)
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
    generationRef.current += 1
    pendingRef.current = false
    setPending(false)
    if (open) {
      returnFocus.current = currentFocusTarget()
      setFailure(null)
      setTyped("")
      setTypedAttempted(false)
    }
  }

  // Opening focus: the field when typing is required, Cancel for destructive
  // actions, else the action itself.
  const focusOnOpen = confirmText !== undefined ? "input" : destructive ? "cancel" : "confirm"
  const typedMatches = confirmText === undefined || normalizeTyped(typed) === normalizeTyped(confirmText)
  const showMismatch = !typedMatches && (typedAttempted || typed.trim() !== "")

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
    const generation = generationRef.current
    const isCurrent = () => mountedRef.current && generation === generationRef.current
    pendingRef.current = true
    setPending(true)
    setFailure(null)
    try {
      await onConfirm()
      if (!isCurrent()) return
      pendingRef.current = false
      setPending(false)
      onOpenChange(false)
    } catch (error) {
      if (!isCurrent()) return
      pendingRef.current = false
      setPending(false)
      setFailure({ error })
    }
  }

  const mapped = failure && errorMessage ? errorMessage(failure.error) : null
  const failureContent = failure ? (hasContent(mapped) ? mapped : fallbackErrorMessage) : null

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
              disabledReason={typedMatches ? undefined : confirmTextLabel}
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
