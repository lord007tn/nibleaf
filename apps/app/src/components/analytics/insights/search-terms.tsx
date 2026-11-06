import { Alert, AlertDescription, AlertTitle } from '@nibleaf/design-system/components/ui/alert';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { useT } from '@nibleaf/i18n/react';
import { Link, useNavigate } from '@tanstack/react-router';
import { EyeOff, Loader2, PenLine } from 'lucide-react';
import { useRef } from 'react';
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
        {visibility === 'disabled_by_setting' ? (
          <Button
            nativeButton={false}
            render={<Link params={{ projectId }} search={{ section: 'integrations' }} to="/app/projects/$projectId/settings" />}
            size="sm"
            variant="outline"
          >
            {t('analytics.search.hidden.openSettings')}
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
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
