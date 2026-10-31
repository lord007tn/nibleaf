import { Button } from '@nibleaf/design-system/components/ui/button';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@nibleaf/design-system/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { siteT } from '@nibleaf/i18n/site';
import { useDebouncedValue } from '@tanstack/react-pacer';
import { useRouter } from '@tanstack/react-router';
import { AlertCircle, FileText, Loader2, Search, Sparkles, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useId, useState } from 'react';
import { hasIcon, PageIcon } from '@/components/site/page-icon';
import { useAnswerSite, useSiteSearch } from '@/hooks/api/site-search';
import { LANGUAGE_CATALOG } from '@/lib/languages';
import { siteHref, siteLanguageParam } from '@/lib/site-paths';
import { useSiteAnalytics } from '@/providers/site-analytics-provider';

const SiteSearchAnswer = lazy(() => import('./site-search-answer'));

/** Wrap occurrences of the query's words in <mark> so matches stand out. */
const splitWithOffsets = (text: string, pattern: RegExp) => {
  const parts: Array<{ key: string; value: string }> = [];
  let offset = 0;
  for (const value of text.split(pattern)) {
    parts.push({ key: `${offset}-${value}`, value });
    offset += value.length;
  }
  return parts;
};

function Highlight({ text, query }: { text: string; query: string }) {
  const tokens = query
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 2)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (tokens.length === 0) {
    return <>{text}</>;
  }
  const splitRe = new RegExp(`(${tokens.join('|')})`, 'gi');
  const testRe = new RegExp(`^(${tokens.join('|')})$`, 'i');
  return (
    <>
      {splitWithOffsets(text, splitRe).map(({ key, value }) =>
        testRe.test(value) ? (
          <mark key={key} className="rounded bg-primary/20 text-foreground">
            {value}
          </mark>
        ) : (
          <span key={key}>{value}</span>
        ),
      )}
    </>
  );
}

export default function SiteSearchDialog({
  projectId,
  open,
  onOpenChange,
  lang,
  defaultLanguage,
  direction,
  version,
  placeholder,
  maxResults,
  versions = [],
  versionFilterEnabled = true,
  aiAnswers,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lang?: string;
  defaultLanguage?: string;
  /** Use the published language's configured direction, independently of the
   * chrome translation locale (which may fall back to English). */
  direction?: 'ltr' | 'rtl';
  /** Non-default version path prefix, e.g. "next". Default/latest is undefined. */
  version?: string;
  /** Configured search prompt (config.search.placeholder); falls back to the localized default. */
  placeholder?: string;
  /** Which key opens search (config.search.hotkey): ⌘K (default) or a bare '/'. */
  hotkey?: 'cmdk' | 'slash';
  maxResults?: number;
  versions?: Array<{ id: string; name: string; slug: string; isDefault: boolean }>;
  versionFilterEnabled?: boolean;
  /** Shows the "Ask AI" mode: the site enables AI answers and the instance
   * can serve them. The answer endpoint still enforces both server-side. */
  aiAnswers?: boolean;
}) {
  const { track } = useSiteAnalytics();
  const router = useRouter();
  const t = siteT(lang);
  const [query, setQuery] = useState('');
  const [requestedMode, setMode] = useState<'search' | 'answer'>('search');
  const mode = aiAnswers ? requestedMode : 'search';
  const modeId = useId();
  const [selectedVersion, setSelectedVersion] = useState(version);
  const baseLanguage = lang?.toLowerCase().split(/[-_]/)[0];
  const rtl = direction ? direction === 'rtl' : (LANGUAGE_CATALOG.find((language) => language.code === baseLanguage)?.rtl ?? false);
  const versionOptions = versions.map((item) => ({ value: item.isDefault ? '__default' : item.slug, label: item.name }));
  // Debounce the typed query before it feeds the search request, so we don't fire a
  // request per keystroke.
  const [debouncedQuery] = useDebouncedValue(query, { wait: 250 });
  // Keyword search is intentionally language-independent. Omitting `language`
  // asks the public endpoint to search every enabled language in the published
  // snapshot; each hit carries its own language for correct localized routing.
  const hitsQuery = useSiteSearch(projectId, debouncedQuery.trim(), undefined, selectedVersion, maxResults, open && mode === 'search');
  const answerMutation = useAnswerSite();
  const queryPending = query.trim() !== debouncedQuery.trim() || hitsQuery.isFetching;
  const hits = query.trim() && !queryPending && !hitsQuery.error ? (hitsQuery.data ?? []) : [];
  // A completed request belongs to the exact question and documentation scope
  // that produced it. Editing the query or version must never relabel old
  // evidence or send its citations into a different version.
  const answerMatchesScope =
    answerMutation.variables?.projectId === projectId &&
    answerMutation.variables.query === query.trim() &&
    answerMutation.variables.language === lang &&
    answerMutation.variables.version === selectedVersion;
  const answer = answerMatchesScope && !answerMutation.isPending ? (answerMutation.data ?? null) : null;
  const answerError = answerMatchesScope && !answerMutation.isPending && answerMutation.error ? t('answerFailed') : null;
  const searchMessage = !query.trim() ? t('searchPrompt') : queryPending ? t('searching') : hitsQuery.error ? t('searchFailed') : t('searchEmpty');

  const ask = () => {
    const q = query.trim();
    if (q.length < 2 || answerMutation.isPending) return;
    answerMutation.mutate({
      projectId,
      query: q,
      // Answers stay in the reader's current language even though ordinary
      // results search the whole multilingual corpus.
      ...(lang ? { language: lang } : {}),
      ...(selectedVersion ? { version: selectedVersion } : {}),
    });
  };

  useEffect(() => {
    if (open) {
      setSelectedVersion(version);
    }
  }, [open, version]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[min(80vh,720px)] overflow-hidden p-0 sm:max-w-2xl"
        data-theme-surface="search"
        dir={rtl ? 'rtl' : 'ltr'}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">{t('searchDocumentation')}</DialogTitle>
        <DialogDescription className="sr-only">{t('searchDescription')}</DialogDescription>
        <Command shouldFilter={false} label={t('searchDocumentation')}>
          {aiAnswers ? (
            <div
              className="flex items-center gap-1 border-b px-3 pt-3"
              role="tablist"
              aria-label={t('searchMode')}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const offset = (event.key === 'ArrowRight') !== rtl ? 1 : -1;
                const index = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : ((mode === 'search' ? 0 : 1) + offset + 2) % 2;
                setMode(index === 0 ? 'search' : 'answer');
                event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus();
              }}
            >
              <button
                type="button"
                role="tab"
                id={`${modeId}-search-tab`}
                aria-controls={`${modeId}-search-panel`}
                aria-selected={mode === 'search'}
                tabIndex={mode === 'search' ? 0 : -1}
                className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm ${mode === 'search' ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground'}`}
                onClick={() => setMode('search')}
              >
                <Search className="size-4" /> {t('results')}
              </button>
              <button
                type="button"
                role="tab"
                id={`${modeId}-answer-tab`}
                aria-controls={`${modeId}-answer-panel`}
                aria-selected={mode === 'answer'}
                tabIndex={mode === 'answer' ? 0 : -1}
                className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm ${mode === 'answer' ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground'}`}
                onClick={() => setMode('answer')}
              >
                <Sparkles className="size-4" /> {t('askAi')}
              </button>
            </div>
          ) : null}
          <div className="flex items-center gap-1 pe-2">
            <div className="min-w-0 flex-1">
              <CommandInput
                placeholder={placeholder?.trim() || t('searchPlaceholder')}
                value={query}
                onValueChange={setQuery}
                maxLength={300}
                onKeyDown={(event) => {
                  if (mode === 'answer' && event.key === 'Enter' && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    ask();
                  }
                }}
              />
            </div>
            <Button aria-label={t('closeSearch')} onClick={() => onOpenChange(false)} size="icon-sm" type="button" variant="ghost">
              <X className="size-4" aria-hidden />
            </Button>
          </div>
          {mode === 'search' && versionFilterEnabled && versions.length > 1 ? (
            <div className="flex flex-col gap-2 border-b px-3 py-2.5 sm:flex-row">
              <Select
                items={versionOptions}
                onValueChange={(value) => setSelectedVersion(!value || value === '__default' ? undefined : value)}
                value={selectedVersion ?? '__default'}
              >
                <SelectTrigger aria-label={t('searchFilterVersion')} className="min-w-0 flex-1 sm:max-w-56">
                  <SelectValue placeholder={t('searchFilterVersion')} />
                </SelectTrigger>
                <SelectContent>
                  {versionOptions.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
          {mode === 'search' ? (
            <section
              id={`${modeId}-search-panel`}
              role={aiAnswers ? 'tabpanel' : undefined}
              aria-labelledby={aiAnswers ? `${modeId}-search-tab` : undefined}
            >
              <CommandList label={t('results')}>
                {hits.length === 0 ? (
                  <div className="py-6 text-center text-sm" role={query.trim() && !queryPending && hitsQuery.error ? 'alert' : 'status'}>
                    {searchMessage}
                  </div>
                ) : (
                  <CommandGroup heading={t('results')}>
                    {hits.map((hit, index) => (
                      <CommandItem
                        key={hit.id}
                        value={hit.id}
                        onSelect={() => {
                          track({
                            name: 'search_result_clicked',
                            path: hit.path,
                            resultId: hit.id,
                            resultPosition: index + 1,
                            language: hit.language,
                          });
                          onOpenChange(false);
                          void router.navigate({
                            href: siteHref(projectId, hit.path, { lang: siteLanguageParam(hit.language, defaultLanguage), version: selectedVersion }),
                          });
                        }}
                      >
                        {hasIcon(hit.icon) ? (
                          <PageIcon name={hit.icon} className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0" dir="auto" lang={hit.language}>
                          <div className="font-medium">
                            <Highlight text={hit.title} query={debouncedQuery} />
                          </div>
                          <div className="truncate text-muted-foreground text-xs">
                            <Highlight text={hit.snippet} query={debouncedQuery} />
                          </div>
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            </section>
          ) : (
            <div
              className="max-h-[55vh] overflow-y-auto p-4"
              dir={rtl ? 'rtl' : 'ltr'}
              id={`${modeId}-answer-panel`}
              role="tabpanel"
              aria-labelledby={`${modeId}-answer-tab`}
            >
              {!answer && !answerError ? (
                <div className="rounded-lg border bg-muted/30 p-4 text-sm">
                  <p className="font-medium">{t('groundedAnswerTitle')}</p>
                  <p className="mt-1 text-muted-foreground">{t('groundedAnswerBody')}</p>
                </div>
              ) : null}
              {answerError ? (
                <div className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm" role="alert">
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <span>{answerError}</span>
                </div>
              ) : null}
              {answer ? (
                <Suspense fallback={null}>
                  <SiteSearchAnswer answer={answer} projectId={projectId} lang={lang} version={selectedVersion} rtl={rtl} />
                </Suspense>
              ) : null}
              <div className="mt-4 flex items-center justify-between gap-3 border-t pt-4">
                <p className="text-muted-foreground text-xs">{t('noAnswer')}</p>
                <Button disabled={query.trim().length < 2 || answerMutation.isPending} onClick={ask} size="sm" type="button">
                  {answerMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {answerMutation.isPending ? t('checking') : t('answer')}
                </Button>
              </div>
            </div>
          )}
        </Command>
      </DialogContent>
    </Dialog>
  );
}
