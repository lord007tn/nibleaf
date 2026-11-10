import type * as React from "react"

import { cn } from '../../lib/utils'

type SectionHeadingLevel = 2 | 3 | 4

/**
 * One group of settings (operations/ui-overhaul.md §5.1): a heading and
 * description above a single bordered panel whose rows are divided by
 * hairlines. The panel is the only bordered surface in a section, so content
 * inside it uses dividers and sub-labels, never another card.
 *
 * `chrome="plain"` drops the panel border for hosts that are already a bordered
 * surface (the editor's Configuration tab). `tone="destructive"` is for the
 * danger zone. Rows are `SettingsRow`s; anything else goes in
 * `SettingsSectionBody` to get the same padding.
 *
 * Deliberately not a labelled region: a settings page has many sections, and a
 * landmark per section drowns the page's real landmarks. Headings carry the
 * structure.
 */
function SettingsSection({
  title,
  description,
  actions,
  headingLevel = 2,
  tone = "default",
  chrome = "panel",
  footer,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & {
  title?: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  headingLevel?: SectionHeadingLevel
  tone?: "default" | "destructive"
  chrome?: "panel" | "plain"
  /** Rendered at the bottom of the panel, e.g. a note or a secondary action. */
  footer?: React.ReactNode
}) {
  const Heading = `h${headingLevel}` as const
  const hasHeader = Boolean(title || description || actions)
  return (
    <section
      data-slot="settings-section"
      data-tone={tone}
      className={cn("min-w-0", className)}
      {...props}
    >
      {hasHeader ? (
        <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1 basis-64">
            {title ? (
              <Heading
                className={cn("break-words font-semibold text-base", tone === "destructive" && "text-destructive")}
              >
                {title}
              </Heading>
            ) : null}
            {description ? (
              <p className="mt-1 max-w-prose text-muted-foreground text-sm">
                {description}
              </p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div
        data-slot="settings-section-panel"
        className={cn(
          "min-w-0 divide-y divide-border",
          chrome === "panel" && "rounded-xl border border-border bg-card",
          chrome === "panel" && tone === "destructive" && "border-destructive/40"
        )}
      >
        {children}
        {footer ? (
          <div
            data-slot="settings-section-footer"
            className={cn(
              "flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-muted-foreground text-sm sm:px-5",
              chrome === "panel" && "rounded-b-xl bg-muted/40"
            )}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </section>
  )
}

/** Padding-matched content inside a section panel that isn't a SettingsRow. */
function SettingsSectionBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="settings-section-body" className={cn("min-w-0 px-4 py-4 sm:px-5", className)} {...props} />
}

export { SettingsSection, SettingsSectionBody }
