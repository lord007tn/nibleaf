import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2Icon } from "lucide-react"

import { cn } from '../../lib/utils'

const buttonVariants = cva(
  "group/button inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-normal text-center transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-background shadow-xs hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "min-h-(--control-size-default) py-1 gap-1.5 px-2.5 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2",
        xs: "h-6 whitespace-nowrap gap-1 rounded-[min(var(--radius-md),8px)] px-2 text-xs in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "min-h-(--control-size-compact) py-1 gap-1 rounded-[min(var(--radius-md),10px)] px-2.5 in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pe-1.5 has-data-[icon=inline-start]:ps-1.5",
        lg: "min-h-(--control-size-large) py-1 gap-1.5 px-2.5 has-data-[icon=inline-end]:pe-2 has-data-[icon=inline-start]:ps-2",
        icon: "size-(--control-size-default)",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),8px)] in-data-[slot=button-group]:rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-(--control-size-compact) rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-md",
        "icon-lg": "size-(--control-size-large)",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

type ButtonLoadingProps = {
  /**
   * Shows a spinner, sets `aria-busy` and disables the button while an action
   * runs. The label stays in the layout (invisible) so the button keeps its
   * width; pass `false` rather than leaving it undefined on buttons that can
   * load, so the markup doesn't change when loading starts.
   */
  loading?: boolean
  /** Optional text shown next to the spinner while loading (e.g. "Saving…"). */
  loadingText?: string
}

function Button({
  className,
  variant = "default",
  size = "default",
  loading,
  loadingText,
  disabled,
  children,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants> & ButtonLoadingProps) {
  // Buttons that never pass `loading` render exactly as before.
  const canLoad = loading !== undefined
  return (
    <ButtonPrimitive
      data-slot="button"
      data-loading={loading ? "" : undefined}
      aria-busy={loading || undefined}
      className={cn(
        buttonVariants({ variant, size, className }),
        canLoad && "data-loading:cursor-progress data-loading:disabled:opacity-100"
      )}
      disabled={disabled || loading}
      {...props}
    >
      {canLoad ? (
        // Both states share one grid cell, so the button is as wide as the
        // wider of the two and never jumps when loading starts or ends.
        <span className="inline-grid items-center justify-items-center gap-[inherit]">
          <span
            className={cn(
              "col-start-1 row-start-1 inline-flex items-center justify-center gap-[inherit]",
              loading && "invisible"
            )}
            aria-hidden={loading && loadingText ? true : undefined}
          >
            {children}
          </span>
          <span
            className={cn(
              "col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5",
              !loading && "invisible"
            )}
            aria-hidden={!loading || !loadingText ? true : undefined}
          >
            <Loader2Icon aria-hidden className="animate-spin motion-reduce:animate-none" />
            {loadingText ? <span>{loadingText}</span> : null}
          </span>
        </span>
      ) : (
        children
      )}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }

