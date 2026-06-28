import { Loader2, Minus, Pencil, Plus, Rocket } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { usePendingChanges, usePublish } from '@/hooks/api';
import type { PendingChange, Project } from '@/hooks/api/types';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';
import { siteHref } from '@/lib/links';
import { cn } from '@/lib/utils';

interface PublishModalProps {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the publish mutation is fired, to hand off to the deploy pipeline. */
  onPublished: () => void;
}

/** Visual treatment per change status. */
const STATUS_META: Record<PendingChange['status'], { icon: typeof Plus; dot: string; chip: string; labelKey: MessageKey; order: number }> = {
  added: { icon: Plus, dot: 'bg-emerald-500', chip: 'text-emerald-600 dark:text-emerald-400', labelKey: 'publish.added', order: 0 },
  modified: { icon: Pencil, dot: 'bg-amber-500', chip: 'text-amber-600 dark:text-amber-400', labelKey: 'publish.modified', order: 1 },
  removed: { icon: Minus, dot: 'bg-rose-500', chip: 'text-rose-600 dark:text-rose-400', labelKey: 'publish.removed', order: 2 },
};

/** Confirmation dialog before publishing — shows a Mintlify-style diff of which
 *  pages will change since the last deploy, plus an optional release message. */
export function PublishModal({ project, open, onOpenChange, onPublished }: PublishModalProps) {
  const t = useT();
  const publish = usePublish(project.id);
  // Only compute the diff while the dialog is open (it re-reads on each open).
  const { data: pending, isPending: loadingChanges } = usePendingChanges(project.id, { enabled: open });

  const [message, setMessage] = useState('');

  // Sort: added → modified → removed, then by path, and only show language chips
  // when the site is multilingual (otherwise the code is just noise).
  const { sorted, multiLang } = useMemo(() => {
    const changes = pending?.changes ?? [];
    const langs = new Set(changes.map((c) => c.languageCode).filter(Boolean));
    const ordered = [...changes].sort((a, b) => STATUS_META[a.status].order - STATUS_META[b.status].order || a.path.localeCompare(b.path));
    return { sorted: ordered, multiLang: langs.size > 1 };
  }, [pending]);

  const doPublish = () => {
    const trimmed = message.trim();
    publish.mutate(trimmed || undefined, {
      onError: (error) => toast.error(error instanceof Error ? error.message : t('publish.failed')),
    });
    setMessage('');
    onOpenChange(false);
    onPublished();
  };

  const count = sorted.length;
  const hasBaseline = pending?.hasBaseline ?? true;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0 sm:max-w-[480px]" showCloseButton={false}>
        <DialogHeader className="gap-1 border-border border-b px-6 pt-5 pb-4">
          <DialogTitle className="font-semibold text-[17px] tracking-tight">{t('publish.title')}</DialogTitle>
          <DialogDescription className="text-[13.5px]">{t('publish.subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-6 py-5">
          <div className="flex items-center gap-3 rounded-xl border border-border px-4 py-3">
            <span
              className="grid size-9 shrink-0 place-items-center rounded-lg text-base"
              style={{ backgroundColor: `${project.color}1a`, color: project.color }}
            >
              ✎
            </span>
            <div className="min-w-0 leading-tight">
              <div className="truncate font-semibold text-[13.5px]">{project.name}</div>
              <div className="truncate font-mono text-[12.5px] text-muted-foreground">{siteHref(project.id)}</div>
            </div>
          </div>

          {/* Changes diff — what this publish will push live. */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-medium text-muted-foreground text-xs uppercase tracking-wide">{t('publish.changes')}</span>
              {!loadingChanges && count > 0 ? (
                <span className="text-muted-foreground text-xs">
                  {hasBaseline
                    ? pending?.lastVersion != null
                      ? t('publish.sinceVersion', { version: pending.lastVersion })
                      : null
                    : t('publish.firstPublish')}
                </span>
              ) : null}
            </div>

            {loadingChanges ? (
              <div className="flex items-center gap-2 rounded-xl border border-border border-dashed px-4 py-5 text-muted-foreground text-sm">
                <Loader2 className="size-4 animate-spin" /> {t('publish.checking')}
              </div>
            ) : count === 0 ? (
              <div className="rounded-xl border border-border border-dashed px-4 py-5 text-center">
                <p className="font-medium text-sm">{t('publish.none')}</p>
                <p className="mt-0.5 text-muted-foreground text-xs">{t('publish.noneHint')}</p>
              </div>
            ) : (
              <ScrollArea className="max-h-52 rounded-xl border border-border">
                <ul className="divide-y divide-border">
                  {sorted.map((change) => {
                    const meta = STATUS_META[change.status];
                    const Icon = meta.icon;
                    return (
                      <li key={`${change.id}-${change.status}`} className="flex items-center gap-2.5 px-3 py-2">
                        <span className={cn('grid size-5 shrink-0 place-items-center rounded-full text-white', meta.dot)}>
                          <Icon className="size-3" strokeWidth={2.5} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              'block truncate font-medium text-[13px]',
                              change.status === 'removed' && 'text-muted-foreground line-through',
                            )}
                          >
                            {change.title || change.path}
                          </span>
                          <span className="block truncate font-mono text-[11px] text-muted-foreground">/{change.path}</span>
                        </span>
                        {multiLang && change.languageCode ? (
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground uppercase">
                            {change.languageCode}
                          </span>
                        ) : null}
                        <span className={cn('shrink-0 text-[11px] font-medium', meta.chip)}>{t(meta.labelKey)}</span>
                      </li>
                    );
                  })}
                </ul>
              </ScrollArea>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="font-medium text-muted-foreground text-xs uppercase tracking-wide" htmlFor="publish-message">
              {t('publish.whatChanged')}
            </label>
            <Input
              id="publish-message"
              placeholder={t('publish.messagePlaceholder')}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !publish.isPending) doPublish();
              }}
            />
          </div>
        </div>

        <DialogFooter className="gap-2.5 px-6 pt-0 pb-5 sm:justify-stretch">
          <DialogClose render={<Button variant="outline" className="h-[42px] flex-none px-4" />}>{t('common.cancel')}</DialogClose>
          <Button className="h-[42px] flex-1" disabled={publish.isPending} onClick={doPublish}>
            {publish.isPending ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
            {t('publish.now')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
