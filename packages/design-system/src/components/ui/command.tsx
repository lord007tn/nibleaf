"use client"

import * as React from "react"
import { Command as CommandPrimitive, defaultFilter, useCommandState } from "cmdk"

import { cn } from '../../lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './dialog'
import {
  InputGroup,
  InputGroupAddon,
} from './input-group'
import { SearchIcon, CheckIcon } from "lucide-react"

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex size-full flex-col overflow-hidden rounded-xl! bg-popover p-1 text-popover-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandDialog({
  title = "Command Palette",
  description,
  children,
  className,
  showCloseButton = false,
  filter,
  label,
  ...props
}: Omit<React.ComponentProps<typeof Dialog>, "children"> & {
  title?: string
  description?: string
  className?: string
  showCloseButton?: boolean
  /** The search input's accessible name. cmdk names its input with
   *  `aria-labelledby` pointing at its own label, which overrides `aria-label`
   *  on the input, so the name must be given here. */
  label?: string
  /** cmdk's ranking; see `contiguousFirstFilter`. */
  filter?: React.ComponentProps<typeof CommandPrimitive>["filter"]
  children: React.ReactNode
}) {
  return (
    <Dialog {...props}>
      <DialogContent
        className={cn(
          "top-1/3 translate-y-0 overflow-hidden rounded-xl! p-0",
          className
        )}
        showCloseButton={showCloseButton}
      >
        {/* Inside the popup so the dialog is labelled/described for assistive tech. */}
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {/* cmdk root: CommandInput/CommandList read their store from this context. */}
        <Command filter={filter} label={label}>{children}</Command>
      </DialogContent>
    </Dialog>
  )
}

/**
 * cmdk 1.1.1 records the active option's id inside the same scheduled flush
 * that selects the first match after a search, before the options re-render,
 * so after typing `aria-activedescendant` names the previous option (or none)
 * until the next arrow key. Re-point it at the option that is actually
 * selected after every commit. React only patches the attribute when cmdk's
 * own value changes, so this correction stays until the next selection.
 */
function useActiveDescendantFix(input: React.RefObject<HTMLInputElement | null>) {
  const selected = useCommandState((state) => state.value)
  const search = useCommandState((state) => state.search)
  React.useLayoutEffect(() => {
    const element = input.current
    const listId = element?.getAttribute("aria-controls")
    if (!element || !listId) return
    const option = document
      .getElementById(listId)
      ?.querySelector<HTMLElement>('[cmdk-item][aria-selected="true"]')
    if (option?.id) element.setAttribute("aria-activedescendant", option.id)
    else element.removeAttribute("aria-activedescendant")
  }, [input, selected, search])
}

function CommandInput({
  className,
  ref,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const setRef = React.useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node
      if (typeof ref === "function") ref(node)
      else if (ref) ref.current = node
    },
    [ref]
  )
  useActiveDescendantFix(inputRef)
  return (
    <div data-slot="command-input-wrapper" className="p-1 pb-0">
      <InputGroup className="rounded-md! border-input/30 bg-input/30 shadow-none! *:data-[slot=input-group-addon]:ps-2! has-[[data-slot=command-input]:focus-visible]:border-ring has-[[data-slot=command-input]:focus-visible]:ring-3 has-[[data-slot=command-input]:focus-visible]:ring-ring/50">
        <CommandPrimitive.Input
          ref={setRef}
          data-slot="command-input"
          className={cn(
            "w-full text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
          {...props}
        />
        <InputGroupAddon>
          <SearchIcon className="size-4 shrink-0 opacity-50" />
        </InputGroupAddon>
      </InputGroup>
    </div>
  )
}

function CommandList({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn(
        "no-scrollbar max-h-72 scroll-py-1 overflow-x-hidden overflow-y-auto outline-none",
        className
      )}
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn("py-6 text-center text-sm", className)}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "overflow-hidden p-1 text-foreground **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium **:[[cmdk-group-heading]]:text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("-mx-1 h-px w-auto bg-border", className)}
      {...props}
    />
  )
}

function CommandItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "group/command-item relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none in-data-[slot=dialog-content]:rounded-lg! data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 data-selected:bg-primary/10 data-selected:text-primary [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 data-selected:**:[svg]:text-primary",
        className
      )}
      {...props}
    >
      {children}
      <CheckIcon className="ms-auto opacity-0 group-has-data-[slot=command-shortcut]/command-item:hidden group-data-[checked=true]/command-item:opacity-100" />
    </CommandPrimitive.Item>
  )
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "ms-auto text-xs tracking-widest text-muted-foreground group-data-selected/command-item:text-primary",
        className
      )}
      {...props}
    />
  )
}

/**
 * cmdk's fuzzy score, but any item whose value or keywords contain the query
 * as one piece outranks one that only matches letters scattered across words
 * ("domain" → "Custom domain" before "DOcuMentAtIoN").
 */
const contiguousFirstFilter: NonNullable<React.ComponentProps<typeof CommandPrimitive>["filter"]> = (value, search, keywords) => {
  const fuzzy = defaultFilter(value, search, keywords)
  if (!fuzzy) return 0
  const query = search.trim().toLowerCase()
  const haystack = [value, ...(keywords ?? [])].join(" ").toLowerCase()
  return query && haystack.includes(query) ? 0.5 + fuzzy / 2 : fuzzy / 2
}

export {
  contiguousFirstFilter,
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}

