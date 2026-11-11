import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { useId } from 'react';
import { type RoleOption, SITE_ROLE_OPTIONS, type SiteRole } from '../model/roles';

/**
 * A role picker as a list of options, each with a one-line description of what
 * the role can do (replaces the run-on legend sentence, WORKSPACE-26). Native
 * radios inside labels: arrow keys move, the whole option is the target.
 */
export function RoleOptionList<Role extends string>({
  legend,
  options,
  value,
  onChange,
  disabled,
  name,
}: {
  legend: string;
  options: readonly RoleOption<Role>[];
  value: Role;
  onChange: (role: Role) => void;
  disabled?: boolean;
  name?: string;
}) {
  const t = useT();
  const fallbackName = useId();
  return (
    <fieldset className="min-w-0" disabled={disabled}>
      <legend className="mb-2 font-medium text-sm">{legend}</legend>
      <div className="grid gap-2">
        {options.map((option) => {
          const checked = option.role === value;
          return (
            <label
              className={cn(
                'flex min-w-0 cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/50',
                checked ? 'border-primary/60 bg-primary/5' : 'border-border hover:bg-muted/50',
                disabled && 'cursor-not-allowed opacity-60',
              )}
              key={option.role}
            >
              <input
                checked={checked}
                className="mt-0.5 size-4 shrink-0 accent-primary"
                name={name ?? fallbackName}
                onChange={() => onChange(option.role)}
                type="radio"
                value={option.role}
              />
              <span className="min-w-0">
                <span className="block font-medium text-sm">{t(option.label)}</span>
                <span className="block text-muted-foreground text-sm">{t(option.description)}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/**
 * A website role select. The trigger shows the role's name; each option says
 * what it can do. `allowed` limits it to roles the actor may give.
 */
export function SiteRoleSelect({
  value,
  onChange,
  label,
  allowed,
  size = 'sm',
  className,
  disabled,
  id,
  describedBy,
}: {
  value: SiteRole;
  onChange: (role: SiteRole) => void;
  /** Accessible name, e.g. "Role for Lina on Docs". */
  label: string;
  allowed?: readonly SiteRole[];
  size?: 'sm' | 'default';
  className?: string;
  disabled?: boolean;
  id?: string;
  describedBy?: string;
}) {
  const t = useT();
  const options = SITE_ROLE_OPTIONS.filter((option) => !allowed || allowed.includes(option.role) || option.role === value);
  return (
    <Select
      disabled={disabled}
      items={options.map((option) => ({ value: option.role, label: t(option.label) }))}
      onValueChange={(next) => next && onChange(next as SiteRole)}
      value={value}
    >
      <SelectTrigger aria-describedby={describedBy} aria-label={label} className={cn('w-28', className)} id={id} size={size}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-w-[min(20rem,calc(100vw-2rem))]">
        {options.map((option) => (
          <SelectItem disabled={allowed && !allowed.includes(option.role)} key={option.role} value={option.role}>
            <span className="flex min-w-0 flex-col gap-0.5 whitespace-normal py-0.5">
              <span className="font-medium">{t(option.label)}</span>
              <span className="text-muted-foreground text-xs leading-snug">{t(option.description)}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
