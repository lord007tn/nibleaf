import * as React from "react"

import { restoreFocusFallback } from '../../lib/focus'
import { cn } from '../../lib/utils'
import { Button } from "./button"

/**
 * The page's "Unsaved changes · Discard · Save" bar (operations/ui-overhaul.md
 * §5.3). This is the view only: the app's form registry decides when it shows,
 * what Save and Discard do, and whether it docks (on mobile, while the
 * on-screen keyboard is open, it sits at the end of the form instead of
 * floating over the focused input).
 *
 * It sticks to the bottom of its scroll container, so render it as the last
 * child of the content column whose forms it serves. While visible it
 * publishes its height as `--save-region-h` on the document, which
 * PageContainer adds to its end padding and focus scroll margins use.
 *
 * `status` is announced politely and stays mounted when the bar hides, so
 * "Saved" is heard after a successful save.
 *
 * Focus contract: when the bar hides while focus was on one of its buttons
 * (Save just succeeded, or Discard), focus moves to `returnFocusTo()` or, by
 * default, the page's h1. Focus anywhere else is left where it is.
 */
function SaveRegion({
  open,
  label,
  message,
  saveLabel,
  savingLabel,
  discardLabel,
  onSave,
  onDiscard,
  saving = false,
  docked = false,
  status,
  returnFocusTo,
  className,
}: {
  open: boolean
  /** The region's accessible name, e.g. "Unsaved changes". */
  label: string
  /** The visible summary, e.g. "Unsaved changes" or "2 sections have changes". */
  message: React.ReactNode
  saveLabel: string
  savingLabel?: string
  discardLabel: string
  onSave: () => void
  onDiscard: () => void
  saving?: boolean
  docked?: boolean
  status?: React.ReactNode
  /** Where focus goes if the bar hides while it had focus. Defaults to the page h1. */
  returnFocusTo?: () => HTMLElement | null
  className?: string
}) {
  const ref = React.useRef<HTMLDivElement>(null)
  const focusInside = React.useRef(false)
  const returnFocusRef = React.useRef(returnFocusTo)
  returnFocusRef.current = returnFocusTo

  React.useEffect(() => {
    if (open || !focusInside.current) return
    focusInside.current = false
    // The focused button was removed with the bar, so focus fell to the body.
    // Only then is it ours to move; anything else means the person moved on.
    const active = document.activeElement
    if (active && active !== document.body) return
    const target = returnFocusRef.current?.() ?? restoreFocusFallback(null)
    // No scroll jump after saving: the person is still reading the form.
    target.focus({ preventScroll: true })
  }, [open])

  React.useLayoutEffect(() => {
    const element = ref.current
    const root = typeof document === "undefined" ? null : document.documentElement
    if (!open || docked || !element || !root) return
    const publish = () => root.style.setProperty("--save-region-h", `${Math.ceil(element.getBoundingClientRect().height)}px`)
    publish()
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(publish)
    observer?.observe(element)
    return () => {
      observer?.disconnect()
      root.style.removeProperty("--save-region-h")
    }
  }, [open, docked])

  return (
    <>
      <div role="status" aria-live="polite" className="sr-only">
        {status}
      </div>
      {open ? (
        <div
          ref={ref}
          role="region"
          aria-label={label}
          data-slot="save-region"
          data-docked={docked ? "" : undefined}
          onFocus={() => {
            focusInside.current = true
          }}
          onBlur={(event) => {
            // Only a move to another element counts as leaving: removing the
            // focused button (the bar hiding) may blur with no related target.
            const next = event.relatedTarget as Node | null
            if (next && !event.currentTarget.contains(next)) focusInside.current = false
          }}
          className={cn(
            "z-20 pt-3",
            docked ? "relative" : "sticky bottom-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
            className
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-border bg-popover px-4 py-2.5 text-popover-foreground shadow-lg motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2">
            <p className="flex min-w-0 items-center gap-2 font-medium text-sm">
              <span aria-hidden className="size-2 shrink-0 rounded-full bg-warning" />
              <span className="min-w-0 break-words">{message}</span>
            </p>
            <div className="ms-auto flex shrink-0 items-center gap-2">
              <Button type="button" variant="ghost" disabled={saving} onClick={onDiscard}>
                {discardLabel}
              </Button>
              <Button type="button" loading={saving} loadingText={savingLabel} onClick={onSave}>
                {saveLabel}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export { SaveRegion }
