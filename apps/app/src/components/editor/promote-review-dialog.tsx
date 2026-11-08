import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nibleaf/design-system/components/ui/dialog';
import type { MessageKey } from '@nibleaf/i18n';
import { useLocale } from '@nibleaf/i18n/react';
import { useId } from 'react';
import type { BranchMergePreview } from '@/hooks/api';
import { groupPromoteChanges, type PromoteGroup, promoteIsBlocked, promoteOutcome } from './promote-review';

const GROUP_TITLES: Record<PromoteGroup, MessageKey> = {
  blocked: 'editor.promote.group.blocked',
  lost: 'editor.promote.group.lost',
  moves: 'editor.promote.group.moves',
  stays: 'editor.promote.group.stays',
};

/** Before promoting a version, lists the pages main changed since the version was
 *  copied, grouped by what promoting does to them. Confirming sends the preview's
 *  fingerprint, so promote applies exactly this list. */
export function PromoteReviewDialog({
  preview,
  versionName,
  pending,
  onConfirm,
  onClose,
}: {
  /** The preview to review; the dialog is open while it's set. */
  preview: BranchMergePreview | null;
  versionName: string;
  pending: boolean;
  onConfirm: (fingerprint: string) => void;
  onClose: () => void;
}) {
  const { locale, t } = useLocale();
  const headingId = useId();
  const groups = groupPromoteChanges(preview?.changedOnMainSinceFork ?? []);
  const blocked = preview ? promoteIsBlocked(preview) : false;
  const losesEdits = groups.some((section) => section.group === 'lost');
  return (
    <Dialog open={preview !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('editor.promote.title', { name: versionName })}</DialogTitle>
          <DialogDescription>{t(blocked ? 'error.promoteBlocked' : 'editor.promote.description')}</DialogDescription>
        </DialogHeader>
        <div className="-mx-6 flex max-h-[55vh] flex-col gap-4 overflow-y-auto px-6">
          {groups.map(({ group, entries }) => (
            <section key={group} aria-labelledby={`${headingId}-${group}`} data-promote-group={group}>
              <h3 id={`${headingId}-${group}`} className="flex items-center gap-2 font-medium text-[13px]">
                {t(GROUP_TITLES[group])}
                <Badge variant={group === 'blocked' || group === 'lost' ? 'destructive' : 'secondary'}>{entries.length}</Badge>
              </h3>
              <ul className="mt-2 divide-y divide-border rounded-lg border border-border">
                {entries.map((entry) => (
                  <li key={`${entry.pageId}:${entry.change}:${entry.onPromote}`} className="flex flex-col gap-0.5 px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{entry.title}</span>
                      <Badge variant="outline" className="uppercase" dir="ltr">
                        {entry.languageCode}
                      </Badge>
                    </span>
                    <span className="truncate text-muted-foreground text-xs" dir="ltr">
                      {entry.path}
                    </span>
                    <span className="text-muted-foreground text-xs">{promoteOutcome(t, entry, locale)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>{t(blocked ? 'deploy.close' : 'common.cancel')}</DialogClose>
          {blocked || !preview ? null : (
            <Button type="button" variant={losesEdits ? 'destructive' : 'default'} loading={pending} onClick={() => onConfirm(preview.fingerprint)}>
              {t('editor.branch.merge')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
