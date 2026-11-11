import { RadioField, RadioGroup } from '@nibleaf/design-system/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { type RoleOption, SITE_ROLE_OPTIONS, type SiteRole } from '../model/roles';

/**
 * A role picker as a list of options, each with a one-line description of what
 * the role can do (replaces the run-on legend sentence, WORKSPACE-26). The
 * design-system RadioGroup: Tab enters once, arrow keys move and choose (in
 * reading order, RTL included), and the whole row is the target.
 *
 * `unavailableReason` keeps a role in the list but unselectable, with the
 * reason shown under it and read with it, instead of hiding it. `disabled` is
 * for a moment the whole list can't change (saving).
 */
export function RoleOptionList<Role extends string>({
  legend,
  options,
  value,
  onChange,
  disabled,
  name,
  unavailableReason,
}: {
  legend: string;
  options: readonly RoleOption<Role>[];
  value: Role;
  onChange: (role: Role) => void;
  disabled?: boolean;
  name?: string;
  unavailableReason?: (role: Role) => string | undefined;
}) {
  const t = useT();
  return (
    <RadioGroup
      className="min-w-0 gap-2"
      disabled={disabled}
      label={legend}
      name={name}
      onValueChange={(next) => onChange(next as Role)}
      value={value}
    >
      {options.map((option) => (
        <RadioField
          className={cn(
            'min-w-0 rounded-lg border border-border px-3 py-2.5 transition-colors',
            'has-data-checked:border-primary/60 has-data-checked:bg-primary/5',
            'not-has-data-checked:hover:bg-muted/50 has-aria-disabled:hover:bg-transparent has-data-disabled:opacity-60',
          )}
          description={t(option.description)}
          disabledReason={unavailableReason?.(option.role)}
          key={option.role}
          label={t(option.label)}
          value={option.role}
        />
      ))}
    </RadioGroup>
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
