import { cn } from '../../lib/utils'

/** A single placeholder block. Pulses gently; stays still for reduced-motion users. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-foreground/8 motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

/*
 * Building blocks for first-load placeholders. Each one is sized like the real
 * content it stands in for (text line height, row height, tile padding), so the
 * page doesn't jump when data arrives. They are hidden from assistive tech:
 * mark the surrounding region with `aria-busy` (and, if useful, a visually
 * hidden "Loading…" status) instead.
 */

// Varied widths read as text rather than a grid of bars.
const LINE_WIDTHS = ["w-full", "w-11/12", "w-4/5", "w-3/4", "w-2/3"]

/** Paragraph-like lines. `lines` defaults to 3; the last line is shorter. */
function SkeletonText({ lines = 3, className, ...props }: React.ComponentProps<"div"> & { lines?: number }) {
  return (
    <div aria-hidden data-slot="skeleton-text" className={cn("flex flex-col gap-2", className)} {...props}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows never reorder
          key={index}
          className={cn("h-4", index === lines - 1 && lines > 1 ? "w-2/3" : LINE_WIDTHS[index % LINE_WIDTHS.length])}
        />
      ))}
    </div>
  )
}

/** A list row: optional leading icon/avatar, a title and a secondary line. */
function SkeletonListRow({ withIcon = true, className, ...props }: React.ComponentProps<"div"> & { withIcon?: boolean }) {
  return (
    <div aria-hidden data-slot="skeleton-list-row" className={cn("flex min-h-12 items-center gap-3 py-2", className)} {...props}>
      {withIcon ? <Skeleton className="size-8 shrink-0 rounded-md" /> : null}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="h-3 w-1/4" />
      </div>
    </div>
  )
}

/** Table body rows (`<tr>`s) matching a real table's column count and row height. */
function SkeletonTableRows({ rows = 5, columns, className }: { rows?: number; columns: number; className?: string }) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows never reorder
        <tr aria-hidden data-slot="skeleton-table-row" className={cn("h-12 border-b", className)} key={row}>
          {Array.from({ length: columns }, (_, column) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder cells never reorder
            <td className="px-2 align-middle" key={column}>
              <Skeleton className={cn("h-4", column === 0 ? "w-3/5" : "ms-auto w-12")} />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

/** A card: heading, a couple of text lines and an action row. */
function SkeletonCard({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div aria-hidden data-slot="skeleton-card" className={cn("flex flex-col gap-4 rounded-xl border border-border p-5", className)} {...props}>
      <Skeleton className="h-5 w-1/3" />
      <SkeletonText lines={2} />
      <Skeleton className="h-8 w-24" />
    </div>
  )
}

/** A KPI / stat tile: small label above a large number, same padding as the real tile. */
function SkeletonStatTile({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div aria-hidden data-slot="skeleton-stat-tile" className={cn("flex flex-col gap-3 rounded-xl border border-border p-5", className)} {...props}>
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-8 w-16" />
    </div>
  )
}

export { Skeleton, SkeletonCard, SkeletonListRow, SkeletonStatTile, SkeletonTableRows, SkeletonText }
