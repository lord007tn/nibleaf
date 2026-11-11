import { CheckboxField } from '@nibleaf/design-system/components/ui/checkbox';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useT } from '@nibleaf/i18n/react';
import { useId, useState } from 'react';
import type { GrantSelection } from '../model/members';
import { matchesQuery } from '../model/person';
import type { SiteRole } from '../model/roles';
import { SiteRoleSelect } from './role-options';

export interface ChecklistWebsite {
  id: string;
  name: string;
}

/** Search appears once the list is long enough to need it. */
const SEARCH_FROM = 8;

/**
 * Which websites someone can open, and their role on each: a checkbox per
 * website and, once checked, a role select on the same line. `defaultRole` is
 * what a newly checked website gets.
 */
export function WebsiteChecklist({
  websites,
  value,
  onChange,
  defaultRole,
  legend,
  description,
  error,
  disabled,
}: {
  websites: ChecklistWebsite[];
  value: GrantSelection;
  onChange: (next: GrantSelection) => void;
  defaultRole: SiteRole;
  legend: string;
  description?: string;
  error?: string | null;
  disabled?: boolean;
}) {
  const t = useT();
  const id = useId();
  const [query, setQuery] = useState('');
  const shown = websites.filter((website) => matchesQuery(query, website.name));
  const checkedCount = Object.keys(value).length;
  const toggle = (websiteId: string, on: boolean) => {
    const next = { ...value };
    if (on) next[websiteId] = value[websiteId] ?? defaultRole;
    else delete next[websiteId];
    onChange(next);
  };

  return (
    <fieldset aria-describedby={cn(description && `${id}-description`, error && `${id}-error`) || undefined} className="min-w-0" disabled={disabled}>
      <legend className="font-medium text-sm">{legend}</legend>
      {description ? (
        <p className="mt-1 text-muted-foreground text-sm" id={`${id}-description`}>
          {description}
        </p>
      ) : null}
      {websites.length >= SEARCH_FROM ? (
        <Input
          aria-label={t('people.checklist.search')}
          className="mt-2"
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('people.checklist.search')}
          type="search"
          value={query}
        />
      ) : null}
      {websites.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed px-3 py-4 text-center text-muted-foreground text-sm">{t('people.checklist.empty')}</p>
      ) : (
        <ul className="mt-2 max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {shown.map((website) => {
            const role = value[website.id];
            return (
              <li className="flex min-h-11 min-w-0 items-center gap-3 px-3 py-1.5" key={website.id}>
                {/* `disabled` is passed on: a fieldset disables native inputs, not this control. */}
                <CheckboxField
                  checked={Boolean(role)}
                  className="min-w-0 flex-1 break-words"
                  disabled={disabled}
                  label={<bdi>{website.name}</bdi>}
                  onCheckedChange={(checked) => toggle(website.id, checked)}
                />
                {role ? (
                  <SiteRoleSelect
                    disabled={disabled}
                    label={t('people.checklist.roleFor', { website: website.name })}
                    onChange={(next) => onChange({ ...value, [website.id]: next })}
                    value={role}
                  />
                ) : null}
              </li>
            );
          })}
          {shown.length === 0 ? <li className="px-3 py-3 text-muted-foreground text-sm">{t('people.checklist.noMatch')}</li> : null}
        </ul>
      )}
      <p aria-live="polite" className="mt-1.5 text-muted-foreground text-xs">
        {checkedCount ? t('people.checklist.selected', { count: checkedCount }) : t('people.checklist.noneSelected')}
      </p>
      {error ? (
        <p className="mt-1 text-destructive text-xs" id={`${id}-error`}>
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
