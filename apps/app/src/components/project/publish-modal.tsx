import { NibleafMark } from '@nibleaf/design-system/brand';
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
import { Input } from '@nibleaf/design-system/components/ui/input';
import { ScrollArea } from '@nibleaf/design-system/components/ui/scroll-area';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { ArrowLeft, FileText, Loader2, type LucideIcon, Minus, Pencil, Plus, Rocket, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { usePendingChanges, usePublish } from '@/hooks/api';
import type { Deployment, PendingChange, Project } from '@/hooks/api/types';
import { type FirstPublishAttribution, readFirstPublishAttribution } from '@/lib/first-publish-activation';
import { siteHref } from '@/lib/links';

interface PublishModalProps {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the publish mutation is fired, to hand off to the deploy pipeline. */
  onPublished: (deployment: Deployment, attribution: FirstPublishAttribution | null) => void;
}

/** Visual treatment per change status. */
const STATUS_META: Record<PendingChange['status'], { icon: LucideIcon; dot: string; chip: string; labelKey: MessageKey; order: number }> = {
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
  const { data: pending, isPending: loadingChanges, isError: preflightFailed } = usePendingChanges(project.id, { enabled: open });

  const [message, setMessage] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Sort: added → modified → removed, then by path, and only show language chips
  // when the site is multilingual (otherwise the code is just noise).
  const { sorted, multiLang } = useMemo(() => {
    const changes = pending?.changes ?? [];
    const langs = new Set(changes.map((c) => c.languageCode).filter(Boolean));
    const ordered = [...changes].sort((a, b) => STATUS_META[a.status].order - STATUS_META[b.status].order || a.path.localeCompare(b.path));
    return { sorted: ordered, multiLang: langs.size > 1 };
  }, [pending]);

  const doPublish = () => {
    if (loadingChanges || preflightFailed || (pending?.redirectIssues?.length ?? 0) > 0) {
      return;
    }
    const trimmed = message.trim();
    const firstPublishAttribution = readFirstPublishAttribution();
    publish.mutate(
      { ...(trimmed ? { message: trimmed } : {}), ...(firstPublishAttribution ? { firstPublishAttribution } : {}) },
      {
        onSuccess: (deployment) => {
          setMessage('');
          onOpenChange(false);
          onPublished(deployment, firstPublishAttribution);
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : t('publish.failed')),
      },
    );
  };

  const count = sorted.length;
  const redirectIssues = pending?.redirectIssues ?? [];
  const publishBlocked = loadingChanges || preflightFailed || redirectIssues.length > 0;
  const hasBaseline = pending?.hasBaseline ?? true;
  const changeKey = useCallback((change: PendingChange) => `${change.id}:${change.status}`, []);
  const selectedChange = sorted.find((change) => changeKey(change) === selectedKey) ?? sorted[0] ?? null;

  useEffect(() => {
    if (sorted.length === 0) {
      setSelectedKey(null);
      setReviewing(false);
      return;
    }
    const first = sorted[0];
    if (first && (!selectedKey || !sorted.some((change) => changeKey(change) === selectedKey))) {
      setSelectedKey(changeKey(first));
    }
  }, [sorted, selectedKey, changeKey]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('gap-0 p-0', reviewing ? 'sm:max-w-[940px]' : 'sm:max-w-[480px]')} showCloseButton={false}>
        <DialogHeader className="gap-1 border-border border-b px-6 pt-5 pb-4">
          {reviewing ? (
            <div className="flex items-center justify-between gap-3">
              <Button variant="ghost" size="sm" className="-ms-2 h-8" onClick={() => setReviewing(false)}>
                <ArrowLeft className="size-4 rtl:-scale-x-100" /> {t('publish.backToSummary')}
              </Button>
              <Button size="sm" disabled={publish.isPending || publishBlocked} onClick={doPublish}>
                {publish.isPending ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
                {t('publish.now')}
              </Button>
            </div>
          ) : (
            <>
              <DialogTitle className="font-semibold text-[17px] tracking-tight">{t('publish.title')}</DialogTitle>
              <DialogDescription className="text-[13.5px]">{t('publish.subtitle')}</DialogDescription>
            </>
          )}
        </DialogHeader>

        {reviewing && selectedChange ? (
          <div className="grid min-h-[520px] grid-cols-[260px_1fr]">
            <aside className="border-border border-e">
              <div className="border-border border-b px-4 py-3">
                <div className="font-semibold text-sm">{t('publish.reviewTitle')}</div>
                <div className="text-muted-foreground text-xs">{t('publish.reviewSubtitle')}</div>
              </div>
              <ScrollArea className="h-[470px]">
                <ul className="p-2">
                  {sorted.map((change) => {
                    const meta = STATUS_META[change.status];
                    const Icon = meta.icon;
                    const active = changeKey(change) === changeKey(selectedChange);
                    return (
                      <li key={changeKey(change)}>
                        <button
                          type="button"
                          onClick={() => setSelectedKey(changeKey(change))}
                          className={cn(
                            'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-start text-sm',
                            active ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                          )}
                        >
                          <span className={cn('grid size-5 shrink-0 place-items-center rounded-full text-white', meta.dot)}>
                            <Icon className="size-3" strokeWidth={2.5} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{change.title || change.path}</span>
                            <span className="block truncate font-mono text-[11px]">/{change.path}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </ScrollArea>
            </aside>
            <section className="min-w-0 bg-[#0b0b0b] text-[#ededed]">
              <div className="border-white/10 border-b px-7 py-5">
                <div className="flex items-center gap-2 text-white/60 text-xs">
                  <FileText className="size-3.5" />
                  <span className="font-mono">/{selectedChange.path}</span>
                  <span className={cn('ms-auto font-medium', STATUS_META[selectedChange.status].chip)}>
                    {t(STATUS_META[selectedChange.status].labelKey)}
                  </span>
                </div>
                <h2 className="mt-2 max-w-2xl font-semibold text-2xl tracking-tight">{selectedChange.title || selectedChange.path}</h2>
                <div className="mt-2 flex gap-3 text-xs">
                  <span className="text-emerald-300">+{selectedChange.additions}</span>
                  <span className="text-rose-300">-{selectedChange.deletions}</span>
                  {selectedChange.fields.length > 0 ? <span className="text-white/45">{selectedChange.fields.join(', ')}</span> : null}
                </div>
              </div>
              <ScrollArea className="h-[430px]">
                <div className="px-7 py-6">
                  <div className="overflow-hidden rounded-md border border-white/10 bg-black/25 font-mono text-[12.5px] leading-6">
                    {selectedChange.lines.length > 0 ? (
                      selectedChange.lines.map((line) => (
                        <div
                          key={`${line.type}-${line.oldLine ?? 'x'}-${line.newLine ?? 'x'}-${line.text}`}
                          className={cn(
                            'grid grid-cols-[48px_1fr] border-s-2 px-3',
                            line.type === 'added' && 'border-emerald-300 bg-emerald-400/15 text-emerald-50',
                            line.type === 'removed' && 'border-rose-300 bg-rose-400/15 text-rose-50',
                            line.type === 'unchanged' && 'border-transparent text-white/55',
                          )}
                        >
                          <span className="select-none text-white/30">{line.newLine ?? line.oldLine ?? ''}</span>
                          <span className={cn('whitespace-pre-wrap break-words', line.type === 'removed' && 'line-through decoration-rose-200/70')}>
                            {line.text || ' '}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="px-3 py-8 text-center text-white/45">{t('publish.noLineDiff')}</div>
                    )}
                    {selectedChange.truncated ? (
                      <div className="border-white/10 border-t px-3 py-2 text-white/45">{t('publish.diffTruncated')}</div>
                    ) : null}
                  </div>
                </div>
              </ScrollArea>
            </section>
          </div>
        ) : (
          <div className="flex flex-col gap-4 px-6 py-5">
            <div className="flex items-center gap-3 rounded-xl border border-border px-4 py-3">
              <NibleafMark className="size-9 shrink-0" />
              <div className="min-w-0 leading-tight">
                <div className="truncate font-semibold text-[13.5px]">{project.name}</div>
                <div className="truncate font-mono text-[12.5px] text-muted-foreground">{siteHref(project.id)}</div>
              </div>
            </div>

            {redirectIssues.length > 0 ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4" role="alert">
                <div className="flex items-center gap-2 font-semibold text-destructive text-sm">
                  <TriangleAlert className="size-4" /> {t('publish.redirectsBlocked')}
                </div>
                <p className="mt-1 text-muted-foreground text-xs">{t('publish.redirectsBlockedHint')}</p>
                <ul className="mt-3 space-y-1.5 text-xs">
                  {redirectIssues.map((issue) => (
                    <li className="font-mono" key={`${issue.code}-${issue.rowIndexes.join('-')}-${issue.sequence.join('-')}-${issue.message}`}>
                      {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {preflightFailed ? (
              <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4" role="alert">
                <div className="flex items-center gap-2 font-semibold text-destructive text-sm">
                  <TriangleAlert className="size-4" /> {t('publish.preflightFailed')}
                </div>
                <p className="mt-1 text-muted-foreground text-xs">{t('publish.preflightFailedHint')}</p>
              </div>
            ) : null}

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
              {!loadingChanges && count > 0 ? (
                <Button type="button" variant="outline" className="h-9 justify-center" onClick={() => setReviewing(true)}>
                  <FileText className="size-4" /> {t('publish.reviewDiff')}
                </Button>
              ) : null}
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
        )}

        {!reviewing ? (
          <DialogFooter className="gap-2.5 px-6 pt-0 pb-5 sm:justify-stretch">
            <DialogClose render={<Button variant="outline" className="h-[42px] flex-none px-4" />}>{t('common.cancel')}</DialogClose>
            <Button className="h-[42px] flex-1" disabled={publish.isPending || publishBlocked} onClick={doPublish}>
              {publish.isPending ? <Loader2 className="size-4 animate-spin" /> : <Rocket className="size-4" />}
              {t('publish.now')}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
