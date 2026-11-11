"use client"

import * as React from "react"
import { MoreHorizontalIcon } from "lucide-react"

import { cn } from '../../lib/utils'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu'
import { IconButton } from './icon-button'
import { SkeletonListRow } from './skeleton'

const borderedClassName = "rounded-xl border border-border bg-card"
/** Matches SettingsRow, so lists and rows line up inside one panel. */
const rowPaddingClassName = "px-4 py-3 sm:px-5"

/**
 * A list of records (members, domains, keys, links) as rows
 * (operations/ui-overhaul.md §6). It usually sits inside a SettingsSection
 * panel and uses its dividers, so it has no border of its own; `bordered`
 * gives it one when it stands alone. Name it with `aria-label` (or
 * `aria-labelledby`) when the heading above doesn't make it obvious.
 */
function DataList({
  bordered = false,
  className,
  ...props
}: React.ComponentProps<"ul"> & { bordered?: boolean }) {
  return (
    <ul
      data-slot="data-list"
      className={cn("min-w-0 divide-y divide-border", bordered && borderedClassName, className)}
      {...props}
    />
  )
}

/**
 * One record. Long names, domains and emails wrap; titles never truncate.
 *
 * `trailingLayout="inline"` (default) keeps compact trailing controls (icon
 * buttons, `RowActions`) on the title line at every width, so actions stay
 * next to the thing they act on, aligned with the title even when the row
 * grows (expanded details). `"stack"` is for wide trailing controls (a
 * role select plus buttons): below ~30rem of row width they move under the
 * content instead of squeezing it.
 */
function DataListItem({
  leading,
  title,
  description,
  meta,
  badges,
  trailing,
  trailingLayout = "inline",
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"li">, "title"> & {
  /** An icon or avatar at the start. */
  leading?: React.ReactNode
  title: React.ReactNode
  description?: React.ReactNode
  /** Secondary facts (dates, counts, roles), small and muted. */
  meta?: React.ReactNode
  /** Status badges next to the title. */
  badges?: React.ReactNode
  /** Controls at the end: buttons, a select, `RowActions`. */
  trailing?: React.ReactNode
  trailingLayout?: "inline" | "stack"
}) {
  return (
    <li data-slot="data-list-item" className={cn("@container/item min-w-0", rowPaddingClassName, className)} {...props}>
      <div
        className={cn(
          "flex min-w-0 gap-3",
          trailingLayout === "inline"
            ? "flex-row items-start"
            : "flex-col @min-[30rem]/item:flex-row @min-[30rem]/item:items-center"
        )}
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {leading ? <div className="flex shrink-0 items-center">{leading}</div> : null}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <div data-slot="data-list-item-title" className="min-w-0 break-words font-medium text-sm">
                {title}
              </div>
              {badges ? <div className="flex flex-wrap items-center gap-1.5">{badges}</div> : null}
            </div>
            {description ? (
              <div data-slot="data-list-item-description" className="mt-0.5 min-w-0 break-words text-muted-foreground text-sm">
                {description}
              </div>
            ) : null}
            {meta ? (
              <div
                data-slot="data-list-item-meta"
                className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 break-words text-muted-foreground text-xs"
              >
                {meta}
              </div>
            ) : null}
            {children}
          </div>
        </div>
        {trailing ? (
          <div
            data-slot="data-list-item-trailing"
            className={cn("flex min-w-0 shrink-0 items-center gap-1", trailingLayout === "stack" && "flex-wrap gap-2")}
          >
            {trailing}
          </div>
        ) : null}
      </div>
    </li>
  )
}

/**
 * First-load placeholder rows sized like real ones. The region is marked busy
 * and announces `loadingLabel` (e.g. "Loading members…") to screen readers.
 */
function DataListSkeleton({
  rows = 3,
  loadingLabel,
  withLeading = true,
  bordered = false,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  rows?: number
  loadingLabel: string
  withLeading?: boolean
  bordered?: boolean
}) {
  return (
    <div data-slot="data-list-skeleton" aria-busy="true" className={cn("min-w-0", bordered && borderedClassName, className)} {...props}>
      <span role="status" className="sr-only">
        {loadingLabel}
      </span>
      <div aria-hidden className="divide-y divide-border">
        {Array.from({ length: rows }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows never reorder
          <div key={index} className={rowPaddingClassName}>
            <SkeletonListRow withIcon={withLeading} className="min-h-10 py-0" />
          </div>
        ))}
      </div>
    </div>
  )
}

/** Holds the empty state (an `EmptyState`) where the list would be. */
function DataListEmpty({
  bordered = false,
  className,
  ...props
}: React.ComponentProps<"div"> & { bordered?: boolean }) {
  return (
    <div
      data-slot="data-list-empty"
      className={cn("min-w-0 px-4 py-8 sm:px-5", bordered && borderedClassName, className)}
      {...props}
    />
  )
}

/**
 * A row's overflow menu. `label` names the row, not the menu ("Actions for
 * docs.acme.com"), because a screen reader lists every row's trigger together.
 */
function RowActions({
  label,
  children,
  align = "end",
  className,
}: {
  label: string
  children: React.ReactNode
  align?: React.ComponentProps<typeof DropdownMenuContent>["align"]
  className?: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton label={label} variant="ghost" size="icon-sm" className={className}>
            <MoreHorizontalIcon aria-hidden />
          </IconButton>
        }
      />
      <DropdownMenuContent align={align} className="w-auto min-w-44 max-w-72">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * One action in `RowActions`. With `disabledReason` the item is disabled and
 * the reason shows as a second line of its text, so touch users see it too.
 */
function RowActionsItem({
  onSelect,
  destructive = false,
  icon,
  disabledReason,
  disabled,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof DropdownMenuItem>, "onSelect" | "onClick" | "variant"> & {
  onSelect?: () => void
  destructive?: boolean
  icon?: React.ReactNode
  disabledReason?: React.ReactNode
}) {
  const hasReason = disabledReason != null && disabledReason !== false && disabledReason !== ""
  return (
    <DropdownMenuItem
      variant={destructive ? "destructive" : "default"}
      disabled={disabled || hasReason}
      onClick={onSelect ? () => onSelect() : undefined}
      className={cn(hasReason && "items-start data-disabled:opacity-100", className)}
      {...props}
    >
      {icon}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={cn("break-words", hasReason && "text-muted-foreground")}>{children}</span>
        {hasReason ? (
          <span data-slot="row-actions-item-reason" className="break-words text-muted-foreground text-xs">
            {disabledReason}
          </span>
        ) : null}
      </span>
    </DropdownMenuItem>
  )
}

export { DataList, DataListEmpty, DataListItem, DataListSkeleton, RowActions, RowActionsItem }
