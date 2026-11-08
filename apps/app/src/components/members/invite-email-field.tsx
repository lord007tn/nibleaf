import { Input } from '@nibleaf/design-system/components/ui/input';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { useDebouncedValue } from '@tanstack/react-pacer';
import { type ComponentProps, useId, useState } from 'react';
import { useInviteSuggestions } from '@/hooks/api';

/**
 * The invite box's email input. As an Admin types, it suggests people who are
 * already on their OTHER sites (name, word or email prefix; the server scopes
 * and caps the list). Picking one fills the address. A combobox: arrow keys
 * move, Enter picks, Escape closes; typing an address that isn't suggested
 * works exactly as before.
 */
export function InviteEmailField({
  projectId,
  value,
  onChange,
  onBlur,
  className,
  ...inputProps
}: { projectId: string; value: string; onChange: (value: string) => void } & Omit<ComponentProps<typeof Input>, 'value' | 'onChange'>) {
  const t = useT();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [query] = useDebouncedValue(value, { wait: 200 });
  // An address that is already complete needs no suggestions.
  const suggestions = useInviteSuggestions(projectId, query, { enabled: open && !query.includes('@') });
  // Only suggestions for exactly what is typed now: never a list left over
  // from an earlier query (the debounce lags the input).
  const current = value.trim().toLowerCase();
  const people =
    open && current && !current.includes('@') && query.trim().toLowerCase() === current && suggestions.isSuccess ? (suggestions.data ?? []) : [];
  const expanded = people.length > 0;

  const pick = (email: string) => {
    onChange(email);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div className="relative">
      <Input
        {...inputProps}
        aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
        aria-autocomplete="list"
        aria-controls={expanded ? listId : undefined}
        aria-expanded={expanded}
        autoComplete="off"
        className={className}
        onBlur={(event) => {
          // Let a click on a suggestion land first.
          setTimeout(() => setOpen(false), 120);
          onBlur?.(event);
        }}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(event) => {
          if (!expanded) return;
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setActive((index) => (index + 1) % people.length);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setActive((index) => (index <= 0 ? people.length - 1 : index - 1));
          } else if (event.key === 'Enter' && active >= 0) {
            event.preventDefault();
            const person = people[active];
            if (person) pick(person.email);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        role="combobox"
        value={value}
      />
      {expanded ? (
        <div
          aria-label={t('members.suggestions.label')}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg"
          id={listId}
          role="listbox"
        >
          {people.map((person, index) => (
            <div
              aria-selected={index === active}
              className={cn(
                'cursor-pointer rounded-md px-2.5 py-1.5 text-sm',
                index === active ? 'bg-accent text-accent-foreground' : 'hover:bg-muted',
              )}
              id={`${listId}-${index}`}
              key={person.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(person.email)}
              role="option"
              tabIndex={-1}
            >
              <span className="block truncate font-medium" dir="auto">
                {person.name || person.email}
              </span>
              {person.name ? (
                <span className="block truncate text-muted-foreground text-xs" dir="ltr">
                  {person.email}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
