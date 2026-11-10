import type * as React from "react"
import { cva } from "class-variance-authority"

import { cn } from '../../lib/utils'

const emptyStateVariants = cva("flex min-w-0 flex-col items-center px-4 text-center", {
  variants: {
    size: {
      section: "py-10",
      page: "py-16",
    },
  },
  defaultVariants: {
    size: "section",
  },
})

/**
 * What a list, table or page shows when there is nothing in it yet
 * (operations/ui-overhaul.md §6): an icon, a title, a sentence on what goes
 * here and the action that adds the first item.
 *
 * `section` sits inside a panel; `page` fills an empty page. The title is a
 * heading (`headingLevel`, default 3) so it shows up in the page outline.
 */
function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  size = "section",
  headingLevel = 3,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "title" | "children"> & {
  /** A lucide icon element; hidden from assistive tech. */
  icon?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  secondaryAction?: React.ReactNode
  size?: "section" | "page"
  headingLevel?: 2 | 3 | 4
}) {
  const Heading = `h${headingLevel}` as const
  const page = size === "page"
  return (
    <div data-slot="empty-state" data-size={size} className={cn(emptyStateVariants({ size }), className)} {...props}>
      {icon ? (
        <div
          aria-hidden="true"
          data-slot="empty-state-icon"
          className={cn(
            "mb-4 flex shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground",
            page ? "size-12 [&_svg:not([class*='size-'])]:size-6" : "size-10 [&_svg:not([class*='size-'])]:size-5"
          )}
        >
          {icon}
        </div>
      ) : null}
      <Heading className={cn("max-w-md break-words font-medium", page ? "text-base" : "text-sm")}>{title}</Heading>
      {description ? (
        <p className="mt-1 max-w-sm break-words text-pretty text-muted-foreground text-sm">{description}</p>
      ) : null}
      {action || secondaryAction ? (
        <div data-slot="empty-state-actions" className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  )
}

export { EmptyState, emptyStateVariants }
