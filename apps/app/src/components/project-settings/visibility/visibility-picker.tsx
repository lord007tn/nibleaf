import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useLocale } from '@nibleaf/i18n/react';
import { Globe, Mail, Users } from 'lucide-react';
import { useId } from 'react';

export type AccessMode = 'PUBLIC' | 'WORKSPACE' | 'READERS';

const OPTIONS: Array<{ mode: AccessMode; icon: typeof Globe; title: MessageKey; body: MessageKey }> = [
  { mode: 'PUBLIC', icon: Globe, title: 'settings.visibility.public.title', body: 'settings.visibility.public.body' },
  { mode: 'WORKSPACE', icon: Users, title: 'settings.visibility.team.title', body: 'settings.visibility.team.body' },
  { mode: 'READERS', icon: Mail, title: 'settings.visibility.readers.title', body: 'settings.visibility.readers.body' },
];

/** What changing from `from` to `to` means for the people reading the site. */
export const visibilityChangeCopy = (from: AccessMode, to: AccessMode): { title: MessageKey; description: MessageKey } => {
  if (to === 'PUBLIC') return { title: 'settings.visibility.confirmPublicTitle', description: 'settings.visibility.confirmPublicBody' };
  if (from === 'PUBLIC') return { title: 'settings.visibility.confirmPrivateTitle', description: 'settings.visibility.confirmPrivateBody' };
  return to === 'WORKSPACE'
    ? { title: 'settings.visibility.confirmToTeamTitle', description: 'settings.visibility.confirmToTeamBody' }
    : { title: 'settings.visibility.confirmToReadersTitle', description: 'settings.visibility.confirmToReadersBody' };
};

/**
 * Who can read the published site, in plain words: Public, Team only, or
 * Invited readers. Native radio buttons (arrow keys and RTL come with them)
 * styled as cards. Choosing only previews; saving asks for a confirmation that
 * says what changes for readers.
 */
export function VisibilityPicker({
  current,
  value,
  onChange,
  onSave,
  saving,
  disabled,
}: {
  current: AccessMode;
  value: AccessMode;
  onChange: (mode: AccessMode) => void;
  onSave: (mode: AccessMode) => Promise<void>;
  saving: boolean;
  disabled: boolean;
}) {
  const { t } = useLocale();
  const confirm = useConfirm();
  const name = useId();

  const save = async () => {
    const copy = visibilityChangeCopy(current, value);
    const ok = await confirm({
      title: t(copy.title),
      description: t(copy.description),
      confirmLabel: t('settings.visibility.confirmAction'),
      // Opening the site to everyone is the change that exposes content.
      destructive: value === 'PUBLIC',
    });
    if (ok) await onSave(value);
  };

  return (
    <div>
      <fieldset className="grid gap-2.5 md:grid-cols-3" disabled={disabled}>
        <legend className="sr-only">{t('settings.visibility.title')}</legend>
        {OPTIONS.map((option) => {
          const selected = option.mode === value;
          const Icon = option.icon;
          const id = `${name}-${option.mode}`;
          return (
            <label
              className={cn(
                'flex h-full cursor-pointer flex-col items-start gap-2 rounded-xl border p-4 text-start transition-colors has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50',
                selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'border-border hover:bg-muted/50',
              )}
              htmlFor={id}
              key={option.mode}
            >
              <input
                aria-describedby={`${id}-body`}
                checked={selected}
                className="sr-only"
                id={id}
                name={name}
                onChange={() => onChange(option.mode)}
                type="radio"
                value={option.mode}
              />
              <span className="flex w-full items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-semibold text-sm">
                  <Icon aria-hidden className={cn('size-4', selected ? 'text-primary' : 'text-muted-foreground')} />
                  {t(option.title)}
                </span>
                {option.mode === current ? (
                  <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-[11px] text-muted-foreground">
                    {t('settings.visibility.current')}
                  </span>
                ) : null}
              </span>
              <span className="text-muted-foreground text-xs leading-relaxed" id={`${id}-body`}>
                {t(option.body)}
              </span>
            </label>
          );
        })}
      </fieldset>
      {value !== current ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button disabled={disabled} loading={saving} onClick={() => void save()} type="button">
            {t('settings.visibility.save')}
          </Button>
          <Button disabled={saving} onClick={() => onChange(current)} type="button" variant="ghost">
            {t('common.cancel')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
