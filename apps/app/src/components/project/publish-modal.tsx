import { NibleafMark } from '@nibleaf/design-system/brand';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@nibleaf/design-system/components/ui/sheet';
import { SkeletonListRow } from '@nibleaf/design-system/components/ui/skeleton';
import { StatusBadge } from '@nibleaf/design-system/components/ui/status-badge';
import { TooltipButton } from '@nibleaf/design-system/components/ui/tooltip-button';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, FileText, type LucideIcon, Minus, Pencil, Plus, Rocket, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { friendlyErrorMessage, useDomains, usePendingChanges, usePublish } from '@/hooks/api';
import { pickLiveDomain } from '@/hooks/api/domain-state';
import type { Deployment, PendingChange, Project, PublishCheck } from '@/hooks/api/types';
import { useProjectAdminStatus } from '@/hooks/use-project-admin-status';
import { type FirstPublishAttribution, readFirstPublishAttribution } from '@/lib/first-publish-activation';
import { canonicalSiteBase } from '@/lib/site-seo';
import { PublishChecks } from './publish-checks';
import { RedirectIssue } from './redirect-issue';

interface PublishModalProps {
  project: Project;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the publish mutation is fired, to hand off to the deploy pipeline. */
  onPublished: (deployment: Deployment, attribution: FirstPublishAttribution | null) => void;
  beforePublish?: () => Promise<void> | Promise<boolean>;
}

const hasCheckErrors = (checks: readonly PublishCheck[] | undefined): boolean => checks?.some((check) => check.severity === 'error') ?? false;

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
    <div className="overflow-hidden rounded-lg border border-border bg-background text-sm leading-6">
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
              <span aria-hidden className="select-none pe-2 text-end font-mono text-muted-foreground/70 text-xs tabular-nums">
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

/** The publish sheet: the checks first, then which pages will change since the
 *  last deploy (with a line-by-line review), then an optional note. A side
 *  sheet, full height, so the checks have room and Publish never scrolls away. */
export function PublishModal({ project, open, onOpenChange, onPublished, beforePublish }: PublishModalProps) {
  const t = useT();
  const publish = usePublish(project.id);
  const domains = useDomains(project.id);
  const redirectRole = useProjectAdminStatus(open ? project.id : undefined);
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
  // The dialog opens on its primary action, not on the optional note.
  const primaryAction = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
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

  const count = sorted.length;
  const redirectIssues = pending?.redirectIssues ?? [];
  const checks = pending?.checks ?? [];
  const checkingChanges = loadingChanges || refreshingChanges;
  // A check error is something the publish would fail on; warnings never block.
  const checksBlock = !checkingChanges && hasCheckErrors(checks);
  const hasBaseline = pending?.hasBaseline ?? true;
  const neverPublished = pending?.hasBaseline === false;
  // An empty page list is not always "nothing to publish": the list only compares
  // pages, while settings, redirects and languages also ship with a publish. The
  // server says when nothing at all would change (upToDate). A first publish
  // needs at least one page to put online.
  const hasPages = sorted.some((change) => change.kind === 'PAGE');
  const nothingToPublish = !checkingChanges && !preflightFailed && (neverPublished ? !hasPages : pending?.upToDate === true);
  // Every blocked state says why, which also keeps the action focusable: a check
  // in progress included, so a background re-check never takes focus away from
  // it (a natively disabled button would drop focus to the page).
  const publishBlockedReason = checkingChanges
    ? t('publish.checking')
    : preflightFailed
      ? t('publish.preflightFailed')
      : redirectIssues.length > 0
        ? t('publish.redirectsBlocked')
        : checksBlock
          ? t('publish.checks.blockedReason')
          : nothingToPublish
            ? t(neverPublished ? 'publish.addPageFirst' : 'publish.upToDate')
            : undefined;
  const publishBlocked = checkingChanges || publishBlockedReason !== undefined;

  // Focus opens on the primary action. While the first check runs it can't take
  // focus, so the dialog itself holds it (never the optional note) and hands it to
  // the action once the check settles, unless the person has moved on already.
  const handedFocus = useRef(false);
  useEffect(() => {
    if (!open) {
      handedFocus.current = false;
      return;
    }
    if (checkingChanges || handedFocus.current) return;
    handedFocus.current = true;
    const active = document.activeElement;
    if (!active || active === document.body || active === popup.current) primaryAction.current?.focus();
  }, [open, checkingChanges]);

  const doPublish = async () => {
    if (publishInFlight.current || publishBlocked) {
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
    if (
      !latestPreflight ||
      latestPreflight.isError ||
      !latestPreflight.data ||
      (latestPreflight.data.redirectIssues?.length ?? 0) > 0 ||
      hasCheckErrors(latestPreflight.data.checks)
    ) {
      if (!latestPreflight || latestPreflight.isError || !latestPreflight.data) toast.error(t('publish.preflightFailed'));
      publishInFlight.current = false;
      setPreparing(false);
      return;
    }
    if (pending?.reviewedStateHash && latestPreflight.data.reviewedStateHash !== pending.reviewedStateHash) {
      toast.error(t('publish.reviewChanged'));
      publishInFlight.current = false;
      setPreparing(false);
      return;
    }
    const trimmed = message.trim();
    const firstPublishAttribution = readFirstPublishAttribution();
    publish.mutate(
      {
        reviewedStateHash: latestPreflight.data.reviewedStateHash,
        ...(trimmed ? { message: trimmed } : {}),
        ...(firstPublishAttribution ? { firstPublishAttribution } : {}),
      },
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

  // Saving the draft, re-checking and sending the publish read as one action.
  const publishing = preparing || publish.isPending;
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

  // One scroll region between a fixed header and footer: Publish and Cancel stay
  // on screen, and the checks are never a scroller inside a scroller.
  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        className={cn(
          'gap-0 p-0 data-[side=right]:w-full',
          reviewing ? 'data-[side=right]:sm:max-w-[min(64rem,100vw)]' : 'data-[side=right]:sm:max-w-[37.5rem]',
        )}
        data-testid="publish-sheet"
        initialFocus={() => {
          const action = primaryAction.current;
          return action && !action.disabled ? action : popup.current;
        }}
        ref={popup}
        showCloseButton={false}
        side="right"
      >
        <SheetHeader className="shrink-0 gap-1 border-border border-b px-5 py-4 sm:px-6">
          {reviewing ? (
            <div className="flex items-center justify-between gap-3">
              <SheetTitle className="sr-only">{t('publish.reviewTitle')}</SheetTitle>
              <SheetDescription className="sr-only">{t('publish.reviewSubtitle')}</SheetDescription>
              <Button variant="ghost" size="sm" className="-ms-2" onClick={() => setReviewing(false)}>
                <ArrowLeft className="size-4 rtl:-scale-x-100" /> {t('publish.backToSummary')}
              </Button>
              <TooltipButton
                disabled={publishBlocked}
                disabledReason={publishBlockedReason}
                loading={publishing}
                onClick={doPublish}
                ref={primaryAction}
                size="sm"
              >
                <Rocket className="size-4" />
                {t('publish.now')}
              </TooltipButton>
            </div>
          ) : (
            <>
              <SheetTitle className="font-semibold text-base tracking-tight">{t('publish.title')}</SheetTitle>
              <SheetDescription>{t(neverPublished ? 'publish.firstPublishHint' : 'publish.subtitle')}</SheetDescription>
            </>
          )}
        </SheetHeader>

        {reviewing && selectedChange ? (
          <div className="flex min-h-0 flex-1 flex-col sm:grid sm:grid-cols-[16rem_minmax(0,1fr)]">
            <aside className="flex max-h-[35dvh] min-h-0 flex-col border-border border-b sm:max-h-none sm:border-e sm:border-b-0">
              <div className="shrink-0 border-border border-b px-4 py-3">
                <div className="font-semibold text-sm">{t('publish.reviewTitle')}</div>
                <div className="text-muted-foreground text-xs">{t('publish.reviewSubtitle')}</div>
              </div>
              <ul className="min-h-0 flex-1 overflow-y-auto p-2">
                {sorted.map((change) => {
                  const meta = STATUS_META[change.status];
                  const Icon = meta.icon;
                  const active = changeKey(change) === changeKey(selectedChange);
                  return (
                    <li key={changeKey(change)}>
                      <button
                        aria-current={active ? 'true' : undefined}
                        type="button"
                        onClick={() => setSelectedKey(changeKey(change))}
                        className={cn(
                          'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-start text-sm pointer-coarse:min-h-11',
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
                          <span className="block truncate text-start font-mono text-xs" dir="ltr">
                            /{change.path}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>
            <section className="flex min-h-0 min-w-0 flex-1 flex-col bg-muted/30 text-foreground">
              <div className="shrink-0 border-border border-b px-5 py-4 sm:px-6">
                <p className={cn('font-medium text-sm', STATUS_META[selectedChange.status].chip)}>{t(STATUS_META[selectedChange.status].labelKey)}</p>
                <h2 className="mt-1.5 break-words font-semibold text-xl" dir="auto">
                  {selectedChange.title || selectedChange.path}
                </h2>
                <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-sm">
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
              <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
                <ChangeLines change={selectedChange} />
              </div>
            </section>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto" data-testid="publish-body">
            <div className="flex flex-col gap-6 px-5 py-5 sm:px-6">
              <div className="flex items-center gap-3 rounded-xl border border-border px-4 py-3">
                <NibleafMark className="size-8 shrink-0" />
                <div className="min-w-0 leading-tight">
                  <div className="truncate font-semibold text-sm">{project.name}</div>
                  {/* A web address reads left to right in every language (otherwise Arabic
                      shows "…/docs.example.com" with the scheme clipped). */}
                  <div className="truncate text-start font-mono text-muted-foreground text-xs" dir="ltr">
                    {canonicalSiteBase(project.id, {
                      slug: project.slug,
                      // Only a domain readers can open (ownership, DNS and HTTPS).
                      primaryDomain: domains.data ? pickLiveDomain(domains.data)?.domain : undefined,
                    })}
                  </div>
                </div>
                {neverPublished ? (
                  <StatusBadge className="ms-auto shrink-0" size="sm">
                    {t('overview.live.unavailable')}
                  </StatusBadge>
                ) : null}
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
                  {redirectRole.isError ? (
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm" role="status">
                      <p>{t('publish.redirectRoleError')}</p>
                      <Button
                        className="min-h-11"
                        loading={redirectRole.retrying}
                        onClick={() => void redirectRole.retry()}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {t('common.retry')}
                      </Button>
                    </div>
                  ) : redirectRole.status === 'admin' ? (
                    <Link
                      className="mt-2 inline-flex min-h-11 items-center text-primary text-sm underline"
                      to="/app/projects/$projectId/settings"
                      params={{ projectId: project.id }}
                      search={{ section: 'redirects' }}
                      onClick={() => onOpenChange(false)}
                    >
                      {t('publish.editRedirects')}
                    </Link>
                  ) : redirectRole.status === 'notAdmin' ? (
                    <p className="mt-3 text-sm">{t('publish.redirectsAskAdmin')}</p>
                  ) : (
                    <p className="mt-3 text-muted-foreground text-sm" role="status">
                      {t('publish.redirectRolePending')}
                    </p>
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

              {/* The safety net comes first: what would break, then what will change. */}
              {preflightFailed ? null : (
                <PublishChecks checks={checks} loading={loadingChanges} onFix={() => handleOpenChange(false)} projectId={project.id} />
              )}

              {/* Changes diff — what this publish will push live. */}
              <section aria-labelledby="publish-changes-heading" className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-medium text-sm" id="publish-changes-heading">
                    {t('publish.changes')}
                  </h3>
                  {refreshingChanges && !loadingChanges ? (
                    // Re-checking a diff that is already on screen: a quiet note, not a skeleton.
                    <span className="text-muted-foreground text-xs" role="status">
                      {t('publish.checking')}
                    </span>
                  ) : !checkingChanges && !nothingToPublish && count > 0 ? (
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
                ) : count === 0 || (neverPublished && !hasPages) ? (
                  <div className="rounded-xl border border-border border-dashed px-4 py-5 text-center" data-testid="publish-empty">
                    {neverPublished ? (
                      // Never published, and no page to put online yet.
                      <p className="font-medium text-sm">{t('publish.addPageFirst')}</p>
                    ) : pending?.upToDate ? (
                      <>
                        <p className="font-medium text-sm">{t('publish.none')}</p>
                        <p className="mt-0.5 text-muted-foreground text-xs">{t('publish.upToDate')}</p>
                      </>
                    ) : (
                      // No page changed, but something that ships with a publish did (redirects, settings).
                      <p className="text-muted-foreground text-xs">{t('publish.noneHint')}</p>
                    )}
                  </div>
                ) : (
                  <ul
                    aria-busy={refreshingChanges || undefined}
                    className={cn('divide-y divide-border rounded-xl border border-border transition-opacity', refreshingChanges && 'opacity-60')}
                  >
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
                                'block truncate font-medium text-sm',
                                change.status === 'removed' && 'text-muted-foreground line-through',
                              )}
                            >
                              <bdi>{change.title || change.path}</bdi>
                            </span>
                            <span className="block truncate text-start font-mono text-muted-foreground text-xs" dir="ltr">
                              /{change.path}
                            </span>
                          </span>
                          {multiLang && change.languageCode ? (
                            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground text-xs uppercase">
                              {change.languageCode}
                            </span>
                          ) : null}
                          <span className={cn('shrink-0 font-medium text-xs', meta.chip)}>{t(meta.labelKey)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {!checkingChanges && !nothingToPublish && count > 0 ? (
                  <Button type="button" variant="outline" className="justify-center" onClick={() => setReviewing(true)}>
                    <FileText className="size-4" /> {t('publish.reviewDiff')}
                  </Button>
                ) : null}
              </section>

              <div className="flex flex-col gap-2">
                <label className="font-medium text-sm" htmlFor="publish-message">
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
          </div>
        )}

        {!reviewing ? (
          <SheetFooter className="mt-0 shrink-0 flex-row gap-2.5 border-border border-t px-5 py-4 sm:px-6">
            <SheetClose render={<Button variant="outline" className="flex-none px-4" size="lg" />}>{t('common.cancel')}</SheetClose>
            <TooltipButton
              className="flex-1"
              disabled={publishBlocked}
              disabledReason={publishBlockedReason}
              loading={publishing}
              onClick={doPublish}
              ref={primaryAction}
              size="lg"
            >
              <Rocket className="size-4" />
              {t('publish.now')}
            </TooltipButton>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
