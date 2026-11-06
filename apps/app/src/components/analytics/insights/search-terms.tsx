import { Alert, AlertDescription, AlertTitle } from '@nibleaf/design-system/components/ui/alert';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { useT } from '@nibleaf/i18n/react';
import { Link, useNavigate } from '@tanstack/react-router';
import { EyeOff, Loader2, PenLine } from 'lucide-react';
import { type ReactNode, useRef } from 'react';
import { toast } from 'sonner';
import type { SearchTermRow, SearchTermsVisibility } from '@/hooks/api/analytics';
import { useCreatePage } from '@/hooks/api/mutations';
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
        {visibility === 'disabled_by_setting' ? <SearchTermsSettingsButton projectId={projectId} /> : null}
      </AlertDescription>
    </Alert>
  );
}

/** Opens the analytics settings where "store public search terms" is turned on. */
function SearchTermsSettingsButton({ projectId }: { projectId: string }) {
  const t = useT();
  return (
    <Button
      nativeButton={false}
      render={<Link params={{ projectId }} search={{ section: 'integrations' }} to="/app/projects/$projectId/settings" />}
      size="sm"
      variant="outline"
    >
      {t('analytics.search.hidden.openSettings')}
    </Button>
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
  return (
    <TermsEmptyState action={disabled && !belowNotice ? <SearchTermsSettingsButton projectId={projectId} /> : null} known={known} reason={reason} />
  );
}

/**
 * "Write an article for this": creates a draft page titled with the search
 * term through the existing page-create mutation and opens it in the editor.
 */
export function WriteArticleButton({ projectId, term }: { projectId: string; term: string }) {
  const t = useT();
  const navigate = useNavigate();
  const createPage = useCreatePage(projectId);
  // The pending state only renders on the next frame; the ref blocks a same-frame double click.
  const inFlight = useRef(false);
  const write = () => {
    if (inFlight.current) return;
    inFlight.current = true;
    createPage.mutate(
      { title: term.slice(0, 200) },
      {
        onSuccess: (page) => {
          toast.success(t('analytics.search.write.created'));
          void navigate({ to: '/app/projects/$projectId/editor', params: { projectId }, search: { page: page.id } });
        },
        onError: (error) => toast.error(error instanceof Error ? error.message : t('analytics.search.write.failed')),
        onSettled: () => {
          inFlight.current = false;
        },
      },
    );
  };
  return (
    <Button aria-label={t('analytics.search.write.aria', { term })} disabled={createPage.isPending} onClick={write} size="sm" variant="outline">
      {createPage.isPending ? <Loader2 aria-hidden className="animate-spin" /> : <PenLine aria-hidden />}
      {t('analytics.search.write.action')}
    </Button>
  );
}
