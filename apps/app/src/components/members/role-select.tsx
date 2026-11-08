import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { useT } from '@nibleaf/i18n/react';
import type { AssignableMemberRole } from '@nibleaf/shared/rbac';
import { ROLE_COPY, ROLE_PICKER_ORDER } from '@/lib/member-roles';

/**
 * Pick the role to grant (invites, role changes). Each option says what the
 * role can do, so people choose without guessing. The trigger shows the name.
 */
export function RoleSelect({
  value,
  onValueChange,
  ariaLabel,
  className,
  size,
  disabled,
  id,
}: {
  value: AssignableMemberRole;
  onValueChange: (role: AssignableMemberRole) => void;
  ariaLabel: string;
  className?: string;
  size?: 'sm' | 'default';
  disabled?: boolean;
  id?: string;
}) {
  const t = useT();
  const items = ROLE_PICKER_ORDER.map((role) => ({ value: role, label: t(ROLE_COPY[role].label) }));
  return (
    <Select disabled={disabled} items={items} onValueChange={(next) => next && onValueChange(next as AssignableMemberRole)} value={value}>
      <SelectTrigger aria-label={ariaLabel} className={className} id={id} size={size}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-w-[min(20rem,calc(100vw-2rem))]">
        {ROLE_PICKER_ORDER.map((role) => (
          <SelectItem key={role} value={role}>
            <span className="flex min-w-0 flex-col gap-0.5 whitespace-normal py-0.5">
              <span className="font-medium">{t(ROLE_COPY[role].label)}</span>
              <span className="text-muted-foreground text-xs leading-snug">{t(ROLE_COPY[role].hint)}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
