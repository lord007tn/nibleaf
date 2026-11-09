import { Alert, AlertDescription, AlertTitle } from '@nibleaf/design-system/components/ui/alert';
import { Button } from '@nibleaf/design-system/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@nibleaf/design-system/components/ui/dialog';
import { useT } from '@nibleaf/i18n/react';
import { canAdminister } from '@nibleaf/shared/rbac';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Eye, EyeOff, PenLine } from 'lucide-react';
import { type ReactNode, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useLanguages, useProjectMembers } from '@/hooks/api';
import type { SearchTermRow, SearchTermsVisibility } from '@/hooks/api/analytics';
import { useCreatePage, useUpdateProjectConfig } from '@/hooks/api/mutations';
import { queryKeys } from '@/hooks/api/query-keys';
import { useSession } from '@/services/auth-client';
import { HIDDEN_TERMS_EXPLANATION } from './labels';

/** A search term as typed by readers, in its own direction; hidden terms get a neutral placeholder. */
export function TermText({ term }: { term: SearchTermRow }) {
  const t = useT();
  if (term.term === null) {
    return <span className="text-muted-foreground italic">{t('analytics.search.hiddenTerm')}</span>;
  }
  return (
    <span className="truncate font-medium" dir="auto">
      {term.term}
    </span>
  );
}

/**
 * Explains in plain words why search terms are not shown: the project has not
 * opted in (with a link to the setting), or the site is private (terms are
 * never stored). The k-anonymity threshold is stated when known.
 */
export function TermsVisibilityNotice({
  projectId,
  visibility,
  threshold,
}: {
  projectId: string;
  visibility: Exclude<SearchTermsVisibility, 'visible'>;
  threshold?: number;
}) {
  const t = useT();
  return (
    <Alert>
      <EyeOff />
      <AlertTitle>{t('analytics.search.hidden.title')}</AlertTitle>
      <AlertDescription className="flex flex-col items-start gap-2">
        <span>{t(HIDDEN_TERMS_EXPLANATION[visibility], { setting: t('settings.analytics.searchTerms.title') })}</span>
        {threshold ? <span>{t('analytics.search.hidden.threshold', { count: threshold })}</span> : null}
        {visibility === 'disabled_by_setting' ? <SearchTermsControls projectId={projectId} threshold={threshold} /> : null}
      </AlertDescription>
    </Alert>
  );
}

/** Default `CLICKHOUSE_SENSITIVE_RETENTION_DAYS`: how long opted-in search text is kept before it is deleted. */
const SEARCH_TEXT_RETENTION_DAYS = 30;
/** The API's k-visit threshold, for responses that don't carry it (overview, page drill-down). */
const DEFAULT_TERM_THRESHOLD = 2;

/**
 * Whether the viewer may change project settings, with the same role check as
 * the settings page. Hidden while membership loads (no flash for editors);
 * offered when it can't be loaded, since the server enforces it anyway.
 */
function useCanChangeProjectSettings(projectId: string) {
  const members = useProjectMembers(projectId);
  const session = useSession();
  if (members.isError) return true;
  if (members.isPending || session.isPending) return false;
  const me = members.data?.members.find((member) => member.user.id === session.data?.user.id);
  return canAdminister(me?.role ?? '');
}

/**
 * Turning search terms on, in place: settings admins get the "Turn on" button
 * (with a confirm that says what is stored) and a quieter link to the settings
 * for turning it off later; everyone else is told who can turn it on.
 */
function SearchTermsControls({ projectId, threshold }: { projectId: string; threshold?: number }) {
  const t = useT();
  if (!useCanChangeProjectSettings(projectId)) {
    return <span className="text-muted-foreground">{t('analytics.search.enable.askAdmin')}</span>;
  }
  return (
    <span className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
      <TurnOnSearchTermsButton projectId={projectId} threshold={threshold ?? DEFAULT_TERM_THRESHOLD} />
      <Button
        nativeButton={false}
        render={<Link params={{ projectId }} search={{ section: 'integrations' }} to="/app/projects/$projectId/settings" />}
        size="sm"
        variant="link"
      >
        {t('analytics.search.hidden.openSettings')}
      </Button>
    </span>
  );
}

/**
 * Confirms, then stores `analytics.storePublicSearchTerms: true` through the
 * same project-config mutation the settings form uses (the server merges the
 * `analytics` section, so GA4/Plausible stay as they are) and refetches the
 * insights. A refused save is explained in the dialog, not as a raw error.
 */
function TurnOnSearchTermsButton({ projectId, threshold }: { projectId: string; threshold: number }) {
  const t = useT();
  const queryClient = useQueryClient();
  const update = useUpdateProjectConfig(projectId);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const turnOn = () => {
    setError(null);
    update.mutate(
      { config: { analytics: { storePublicSearchTerms: true } } },
      {
        onSuccess: () => {
          setOpen(false);
          toast.success(t('analytics.search.enable.done'));
          void queryClient.invalidateQueries({ queryKey: queryKeys.analytics.insightsForProject(projectId) });
        },
        onError: (failure) =>
          setError(t((failure as { status?: number }).status === 403 ? 'analytics.search.enable.forbidden' : 'analytics.search.enable.failed')),
      },
    );
  };
  const points = [
    t('analytics.search.enable.retention', { days: SEARCH_TEXT_RETENTION_DAYS }),
    t('analytics.search.enable.threshold', { count: threshold }),
    t('analytics.search.enable.redaction'),
    t('analytics.search.enable.forward'),
    t('analytics.search.enable.offLater'),
  ];
  return (
    <Dialog
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setError(null);
      }}
      open={open}
    >
      <DialogTrigger render={<Button size="sm" variant="outline" />}>
        <Eye aria-hidden />
        {t('analytics.search.enable.action')}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('analytics.search.enable.title')}</DialogTitle>
          <DialogDescription>{t('analytics.search.enable.description')}</DialogDescription>
        </DialogHeader>
        <ul className="flex list-disc flex-col gap-1.5 ps-5 text-sm">
          {points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose render={<Button disabled={update.isPending} variant="outline" />}>{t('common.cancel')}</DialogClose>
          <Button loading={update.isPending} onClick={turnOn}>
            {t('analytics.search.enable.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * What a term list shows when it has no rows: the figure that is still known
 * (e.g. how many searches found nothing) over the honest reason no term is
 * listed. Never claims "nothing happened" when terms are merely hidden.
 */
export function TermsEmptyState({ known, reason, action }: { known?: string | null; reason?: string | null; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5 py-6 text-center text-sm" data-terms-empty="">
      {known ? <p className="font-medium text-foreground">{known}</p> : null}
      {reason ? <p className="max-w-prose text-balance text-muted-foreground">{reason}</p> : null}
      {action}
    </div>
  );
}

/**
 * The empty state of a term list whose terms are hidden by the project setting
 * or because the site is private. `belowNotice` lists sit under the full
 * `TermsVisibilityNotice` and only point at it; standalone lists (overview,
 * page drill-down) carry the short reason and the settings link themselves.
 */
export function HiddenTermsEmpty({
  projectId,
  visibility,
  known,
  belowNotice = false,
}: {
  projectId: string;
  visibility: Exclude<SearchTermsVisibility, 'visible'>;
  known?: string | null;
  belowNotice?: boolean;
}) {
  const t = useT();
  const disabled = visibility === 'disabled_by_setting';
  const reason = disabled
    ? t(belowNotice ? 'analytics.search.hiddenReason.seeAbove' : 'analytics.search.hiddenReason.disabled')
    : t('analytics.search.hiddenReason.private');
  return <TermsEmptyState action={disabled && !belowNotice ? <SearchTermsControls projectId={projectId} /> : null} known={known} reason={reason} />;
}

/**
 * "Write an article for this": creates a draft page titled with the search
 * term (or a reader's unanswered question) through the existing page-create
 * mutation and opens it in the editor. With `languageCode` the draft is
 * created in that content language when the site has it, so an Arabic
 * question becomes an Arabic draft.
 */
export function WriteArticleButton({
  projectId,
  term,
  languageCode,
  label,
}: {
  projectId: string;
  term: string;
  languageCode?: string;
  /** Visible text; defaults to the search report's "Write an article". */
  label?: string;
}) {
  const t = useT();
  const navigate = useNavigate();
  const createPage = useCreatePage(projectId);
  const { data: languages } = useLanguages(languageCode ? projectId : undefined);
  const languageId = languageCode ? languages?.find((language) => language.code === languageCode)?.id : undefined;
  // The pending state only renders on the next frame; the ref blocks a same-frame double click.
  const inFlight = useRef(false);
  const write = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    createPage.mutate(
      { title: term.slice(0, 200), ...(languageId ? { languageId } : {}) },
      {
        onSuccess: (page) => {
          toast.success(t('analytics.search.write.created'));
          void navigate({ to: '/app/projects/$projectId/editor', params: { projectId }, search: { page: page.id } });
        },
        // Plain language, never the server's raw message. (useCreatePage is shared with
        // the editor, which reports its own failures, so no `meta.errorMessage` there.)
        onError: () => toast.error(t('analytics.search.write.failed')),
        onSettled: () => {
          inFlight.current = false;
        },
      },
    );
  };
  return (
    <Button aria-label={t('analytics.search.write.aria', { term })} loading={createPage.isPending} onClick={write} size="sm" variant="outline">
      <PenLine aria-hidden />
      {label ?? t('analytics.search.write.action')}
    </Button>
  );
}
