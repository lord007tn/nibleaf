import type * as React from "react"

import { cn } from '../../lib/utils'

/**
 * The one content column for dashboard pages (operations/ui-overhaul.md §5.1).
 * Gutters are fixed here so pages never pick their own; the column is
 * start-aligned, never centred. `default` (760px) is for forms, `wide`
 * (1040px) for list-heavy screens, `full` for analytics and overview grids.
 *
 * The end padding grows by `--save-region-h` while a SaveRegion is showing, so
 * the last row of a form can always scroll clear of it.
 */
const COLUMN_WIDTH = {
  default: "max-w-[47.5rem]",
  wide: "max-w-[65rem]",
  full: "max-w-none",
} as const

type PageContainerWidth = keyof typeof COLUMN_WIDTH

function PageContainer({
  width = "default",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { width?: PageContainerWidth }) {
  return (
    <div
      data-slot="page-container"
      data-width={width}
      className="w-full min-w-0 px-4 pt-6 pb-[calc(2rem+var(--save-region-h,0px))] sm:px-6 lg:px-8 lg:pt-8"
      {...props}
    >
      <div className={cn("me-auto flex w-full min-w-0 flex-col gap-8", COLUMN_WIDTH[width], className)}>{children}</div>
    </div>
  )
}

export { PageContainer, type PageContainerWidth }
