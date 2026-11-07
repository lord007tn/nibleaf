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
import { SkeletonListRow } from '@nibleaf/design-system/components/ui/skeleton';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { canAdminister } from '@nibleaf/shared/rbac';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, FileText, type LucideIcon, Minus, Pencil, Plus, Rocket, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { friendlyErrorMessage, useDomains, usePendingChanges, useProjectMembers, usePublish } from '@/hooks/api';
import type { Deployment, PendingChange, Project } from '@/hooks/api/types';
import { type FirstPublishAttribution, readFirstPublishAttribution } from '@/lib/first-publish-activation';
import { canonicalSiteBase } from '@/lib/site-seo';
import { useSession } from '@/services/auth-client';
import { RedirectIssue } from './redirect-issue';

interface PublishModalProps {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the publish mutation is fired, to hand off to the deploy pipeline. */
  onPublished: (deployment: Deployment, attribution: FirstPublishAttribution | null) => void;
  beforePublish?: () => Promise<void> | Promise<boolean>;
}

/** Visual treatment per change status. */
const STATUS_META: Record<PendingChange['status'], { icon: LucideIcon; dot: string; chip: string; labelKey: MessageKey; order: number }> = {
  added: { icon: Plus, dot: 'bg-emerald-500', chip: 'text-emerald-600 dark:text-emerald-400', labelKey: 'publish.added', order: 0 },
  modified: { icon: Pencil, dot: 'bg-amber-500', chip: 'text-amber-600 dark:text-amber-400', labelKey: 'publish.modified', order: 1 },
  removed: { icon: Minus, dot: 'bg-rose-500', chip: 'text-rose-600 dark:text-rose-400', labelKey: 'publish.removed', order: 2 },
};

type ChangeLine = PendingChange['lines'][number];
export type ReviewRow = { kind: 'line'; line: ChangeLine } | { kind: 'gap'; key: string };

/** The changed lines of a page with a few unchanged lines around each change.
 *  Longer unchanged stretches collapse into a gap, so a one-word fix in a long
 *  article is on screen at once instead of somewhere in the whole page. */
export const reviewRows = (lines: readonly ChangeLine[], context = 3): ReviewRow[] => {
  const keep = lines.map(() => false);
  lines.forEach((line, index) => {
    if (line.type === 'unchanged') return;
    for (let near = Math.max(0, index - context); near <= Math.min(lines.length - 1, index + context); near++) keep[near] = true;
  });
  const rows: ReviewRow[] = [];
  let skipped = false;
  lines.forEach((line, index) => {
    if (!keep[index]) {
      skipped = true;
      return;
    }
    if (skipped) rows.push({ kind: 'gap', key: `gap-${index}` });
    skipped = false;
    rows.push({ kind: 'line', line });
  });
  if (skipped) rows.push({ kind: 'gap', key: 'gap-end' });
  return rows;
};

const LINE_META = {
  added: {
    marker: '+',
    labelKey: 'publish.added',
    row: 'border-emerald-500 bg-emerald-500/10 text-foreground',
    mark: 'text-emerald-700 dark:text-emerald-400',
  },
  removed: {
    marker: '−',
    labelKey: 'publish.removed',
    row: 'border-rose-500 bg-rose-500/10 text-foreground',
    mark: 'text-rose-700 dark:text-rose-400',
  },
} as const satisfies Record<'added' | 'removed', { marker: string; labelKey: MessageKey; row: string; mark: string }>;

/** What changed in one page's text, line by line. Theme tokens only (readable in
 *  light and dark), each line takes its own direction (an Arabic sentence in an
 *  English page reads right to left and the reverse), and an added/removed line
 *  says so in words for screen readers, not only by colour and sign. */
function ChangeLines({ change }: { change: PendingChange }) {
  const t = useT();
  const hasTextChanges = change.lines.some((line) => line.type !== 'unchanged');
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background text-[13px] leading-6">
      {hasTextChanges ? (
        reviewRows(change.lines).map((row) => {
          if (row.kind === 'gap') {
            return (
              // Screen readers hear that lines were skipped, not a silent jump.
              <div className="border-border border-y bg-muted/60 text-center text-muted-foreground leading-5" key={row.key}>
                <span aria-hidden>⋯</span>
                <span className="sr-only">{t('publish.unchangedHidden')}</span>
              </div>
            );
          }
          const { line } = row;
          const meta = line.type === 'unchanged' ? null : LINE_META[line.type];
          return (
            <div
              className={cn(
                'grid grid-cols-[2.75rem_1.5rem_minmax(0,1fr)] border-s-2 pe-3',
                meta ? meta.row : 'border-transparent text-muted-foreground',
              )}
              key={`${line.type}-${line.oldLine ?? 'x'}-${line.newLine ?? 'x'}`}
            >
              <span aria-hidden className="select-none pe-2 text-end font-mono text-[11.5px] text-muted-foreground/70 tabular-nums">
                {line.newLine ?? line.oldLine ?? ''}
              </span>
              <span className={cn('select-none text-center font-mono', meta?.mark)}>
                {meta ? (
                  <>
                    <span aria-hidden>{meta.marker}</span>
                    <span className="sr-only">{t(meta.labelKey)}</span>
                  </>
                ) : null}
              </span>
              <span className="min-w-0 whitespace-pre-wrap break-words" dir="auto">
                {line.text || ' '}
              </span>
            </div>
          );
        })
      ) : (
        <p className="px-3 py-8 text-center text-muted-foreground text-sm">{t('publish.noLineDiff')}</p>
      )}
      {change.truncated ? <p className="border-border border-t px-3 py-2 text-muted-foreground text-xs">{t('publish.diffTruncated')}</p> : null}
    </div>
  );
}

/** Confirmation dialog before publishing — shows a Mintlify-style diff of which
 *  pages will change since the last deploy, plus an optional release message. */
export function PublishModal({ project, open, onOpenChange, onPublished, beforePublish }: PublishModalProps) {
  const t = useT();
  const publish = usePublish(project.id);
  const domains = useDomains(project.id);
  const { data: memberData } = useProjectMembers(open ? project.id : undefined);
  const { data: session } = useSession();
  const canManageRedirects = canAdminister(memberData?.members.find((member) => member.user.id === session?.user.id)?.role ?? '');
  // Only compute the diff while the dialog is open (it re-reads on each open).
  const {
    data: pending,
    isPending: loadingChanges,
    isFetching: refreshingChanges,
    isError: preflightFailed,
    refetch: refreshPreflight,
  } = usePendingChanges(project.id, { enabled: open });

  const [message, setMessage] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const publishInFlight = useRef(false);
  const attemptToken = useRef(0);
  const mounted = useRef(true);
  const currentlyOpen = useRef(open);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      attemptToken.current += 1;
    };
  }, []);

  useLayoutEffect(() => {
    currentlyOpen.current = open;
    if (!open) {
      attemptToken.current += 1;
      publishInFlight.current = false;
      setPreparing(false);
    }
  }, [open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      attemptToken.current += 1;
      publishInFlight.current = false;
      setPreparing(false);
    }
    onOpenChange(nextOpen);
  };

  // Sort: added → modified → removed, then by path, and only show language chips
  // when the site is multilingual (otherwise the code is just noise).
  const { sorted, multiLang } = useMemo(() => {
    const changes = pending?.changes ?? [];
    const langs = new Set(changes.map((c) => c.languageCode).filter(Boolean));
    const ordered = [...changes].sort((a, b) => STATUS_META[a.status].order - STATUS_META[b.status].order || a.path.localeCompare(b.path));
    return { sorted: ordered, multiLang: langs.size > 1 };
  }, [pending]);

  const doPublish = async () => {
    if (publishInFlight.current || loadingChanges || refreshingChanges || preflightFailed || (pending?.redirectIssues?.length ?? 0) > 0) {
      return;
    }
    const token = ++attemptToken.current;
    const isCurrentAttempt = () => mounted.current && currentlyOpen.current && attemptToken.current === token;
    publishInFlight.current = true;
    setPreparing(true);
    try {
      const allowed = await beforePublish?.();
      if (!isCurrentAttempt()) return;
      if (allowed === false) {
        publishInFlight.current = false;
        setPreparing(false);
        return;
      }
    } catch {
      if (!isCurrentAttempt()) return;
      toast.error(t('editor.saveError'));
      publishInFlight.current = false;
      setPreparing(false);
      return;
    }
    // A save can change redirects or the reviewed pages. Re-read preflight
    // after the save barrier instead of publishing from a cached review.
    const latestPreflight = await refreshPreflight().catch(() => null);
    if (!isCurrentAttempt()) return;
    if (!latestPreflight || latestPreflight.isError || !latestPreflight.data || (latestPreflight.data.redirectIssues?.length ?? 0) > 0) {
      if (!latestPreflight || latestPreflight.isError || !latestPreflight.data) toast.error(t('publish.preflightFailed'));
      publishInFlight.current = false;
      setPreparing(false);
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
        onError: (error) => toast.error(friendlyErrorMessage(t, error, 'publish.failed')),
        onSettled: () => {
          if (!isCurrentAttempt()) return;
          publishInFlight.current = false;
          setPreparing(false);
        },
      },
    );
  };

  const count = sorted.length;
  const redirectIssues = pending?.redirectIssues ?? [];
  const checkingChanges = loadingChanges || refreshingChanges;
  // An empty article diff is not "nothing to publish": the preflight only compares
  // pages, while redirects and language settings also ship with a publish.
  const publishBlocked = checkingChanges || preflightFailed || redirectIssues.length > 0;
  // Saving the draft, re-checking and sending the publish read as one action.
  const publishing = preparing || publish.isPending;
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
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn('max-h-[90dvh] gap-0 overflow-y-auto p-0', reviewing ? 'sm:max-w-[940px]' : 'sm:max-w-[480px]')}
        showCloseButton={false}
      >
        <DialogHeader className="gap-1 border-border border-b px-6 pt-5 pb-4">
          {reviewing ? (
            <div className="flex items-center justify-between gap-3">
              <DialogTitle className="sr-only">{t('publish.reviewTitle')}</DialogTitle>
              <DialogDescription className="sr-only">{t('publish.reviewSubtitle')}</DialogDescription>
              <Button variant="ghost" size="sm" className="-ms-2 h-8" onClick={() => setReviewing(false)}>
                <ArrowLeft className="size-4 rtl:-scale-x-100" /> {t('publish.backToSummary')}
              </Button>
              <Button size="sm" disabled={publishBlocked} loading={publishing} onClick={doPublish}>
                <Rocket className="size-4" />
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
          <div className="grid min-h-0 grid-cols-1 sm:min-h-[520px] sm:grid-cols-[260px_1fr]">
            <aside className="border-border border-e">
              <div className="border-border border-b px-4 py-3">
                <div className="font-semibold text-sm">{t('publish.reviewTitle')}</div>
                <div className="text-muted-foreground text-xs">{t('publish.reviewSubtitle')}</div>
              </div>
              <ScrollArea className="h-36 sm:h-[470px]">
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
                            <span className="block truncate font-medium">
                              <bdi>{change.title || change.path}</bdi>
                            </span>
                            <span className="block truncate text-start font-mono text-[11px]" dir="ltr">
                              /{change.path}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </ScrollArea>
            </aside>
            <section className="flex min-w-0 flex-col bg-muted/30 text-foreground">
              <div className="border-border border-b px-6 py-5">
                <p className={cn('text-sm font-medium', STATUS_META[selectedChange.status].chip)}>{t(STATUS_META[selectedChange.status].labelKey)}</p>
                <h2 className="mt-2 break-words text-2xl font-semibold" dir="auto">
                  {selectedChange.title || selectedChange.path}
                </h2>
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-sm">
                  <span className="break-all" dir="ltr">
                    /{selectedChange.path}
                  </span>
                  {selectedChange.additions > 0 || selectedChange.deletions > 0 ? (
                    <span className="flex gap-2 font-mono text-xs tabular-nums" dir="ltr">
                      <span className="text-emerald-700 dark:text-emerald-400">+{selectedChange.additions}</span>
                      <span className="text-rose-700 dark:text-rose-400">−{selectedChange.deletions}</span>
                    </span>
                  ) : null}
                </p>
              </div>
              <ScrollArea className="h-[40dvh] sm:h-[400px]">
                <div className="p-4 sm:p-6">
                  <ChangeLines change={selectedChange} />
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
                {/* A web address reads left to right in every language (otherwise Arabic
                    shows "…/docs.example.com" with the scheme clipped). */}
                <div className="truncate text-start font-mono text-[12.5px] text-muted-foreground" dir="ltr">
                  {canonicalSiteBase(project.id, {
                    slug: project.slug,
                    primaryDomain: domains.data?.find((item) => item.verified && item.isPrimary)?.domain,
                  })}
                </div>
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
                    <RedirectIssue issue={issue} key={`${issue.code}-${issue.rowIndexes.join('-')}-${issue.sequence.join('-')}`} />
                  ))}
                </ul>
                {canManageRedirects ? (
                  <Link
                    className="mt-2 inline-flex min-h-11 items-center text-primary text-sm underline"
                    to="/app/projects/$projectId/settings"
                    params={{ projectId: project.id }}
                    search={{ section: 'appearance', appearanceSection: 'redirects' }}
                    onClick={() => onOpenChange(false)}
                  >
                    {t('publish.editRedirects')}
                  </Link>
                ) : (
                  <p className="mt-3 text-sm">{t('publish.redirectsAskAdmin')}</p>
                )}
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
                {refreshingChanges && !loadingChanges ? (
                  // Re-checking a diff that is already on screen: a quiet note, not a skeleton.
                  <span className="text-muted-foreground text-xs" role="status">
                    {t('publish.checking')}
                  </span>
                ) : !checkingChanges && count > 0 ? (
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
                <div aria-busy="true" className="rounded-xl border border-border px-3">
                  <p className="sr-only" role="status">
                    {t('publish.checking')}
                  </p>
                  {['a', 'b', 'c'].map((row) => (
                    <SkeletonListRow className="min-h-11" key={row} />
                  ))}
                </div>
              ) : count === 0 ? (
                <div className="rounded-xl border border-border border-dashed px-4 py-5 text-center">
                  <p className="font-medium text-sm">{t('publish.none')}</p>
                  <p className="mt-0.5 text-muted-foreground text-xs">{t('publish.noneHint')}</p>
                </div>
              ) : (
                <ScrollArea
                  aria-busy={refreshingChanges || undefined}
                  className={cn('max-h-52 rounded-xl border border-border transition-opacity', refreshingChanges && 'opacity-60')}
                >
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
                            <span className="block truncate text-start font-mono text-[11px] text-muted-foreground" dir="ltr">
                              /{change.path}
                            </span>
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
              {!checkingChanges && count > 0 ? (
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
            <Button className="h-[42px] flex-1" disabled={publishBlocked} loading={publishing} onClick={doPublish}>
              <Rocket className="size-4" />
              {t('publish.now')}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
