import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { SettingsSectionBody } from '@nibleaf/design-system/components/ui/settings-section';
import { useT } from '@nibleaf/i18n/react';

/**
 * "Someone else changed this while you were editing", with Use theirs / Keep
 * mine for every conflicting field of a `useServerDraftForm` draft. Renders
 * nothing without conflicts.
 */
export function DraftConflicts<K extends string>({
  conflicts,
  resolve,
}: {
  conflicts: readonly K[];
  resolve: (key: K, choice: 'theirs' | 'mine') => void;
}) {
  const t = useT();
  if (conflicts.length === 0) return null;
  const resolveAll = (choice: 'theirs' | 'mine') => {
    for (const key of conflicts) resolve(key, choice);
  };
  return (
    <SettingsSectionBody>
      <Callout
        action={
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => resolveAll('theirs')} size="sm" type="button" variant="outline">
              {t('forms.useTheirs')}
            </Button>
            <Button onClick={() => resolveAll('mine')} size="sm" type="button" variant="ghost">
              {t('forms.keepMine')}
            </Button>
          </div>
        }
        tone="warning"
      >
        {t('forms.changedElsewhere')}
      </Callout>
    </SettingsSectionBody>
  );
}
