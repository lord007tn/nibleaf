import type * as React from "react"

import { cn } from '../../lib/utils'

type HeadingLevel = 1 | 2 | 3

/**
 * A page's title row (operations/ui-overhaul.md §5.1): the page's single h1, an
 * optional one-line description, a badge next to the title and actions at the
 * end. Actions wrap under the title on narrow screens instead of squeezing it.
 *
 * Hosts that embed a page inside another page (the editor's Configuration tab)
 * pass `headingLevel` so the outline stays in order.
 */
function PageHeader({
  title,
  description,
  actions,
  badge,
  back,
  headingLevel = 1,
  titleId,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  badge?: React.ReactNode
  /** A back link rendered above the title (e.g. "← Integrations"). */
  back?: React.ReactNode
  headingLevel?: HeadingLevel
  /** Id for the heading, so a landmark or dialog can be labelled by it. */
  titleId?: string
}) {
  const Heading = `h${headingLevel}` as const
  return (
    <div data-slot="page-header" className={cn("flex min-w-0 flex-col gap-2", className)} {...props}>
      {back ? <div className="text-sm">{back}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-64">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <Heading
              id={titleId}
              // Focus lands here on section change; never show a ring for it.
              tabIndex={-1}
              className="min-w-0 break-words font-semibold text-xl tracking-tight outline-none"
            >
              {title}
            </Heading>
            {badge}
          </div>
          {description ? <p className="mt-1 max-w-prose text-muted-foreground text-sm">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  )
}

export { PageHeader }
