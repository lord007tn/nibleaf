import { Button } from '@nibleaf/design-system/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@nibleaf/design-system/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { siteT } from '@nibleaf/i18n/site';
import { useDebouncedValue } from '@tanstack/react-pacer';
import { AlertCircle, FileText, Loader2, Search, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { hasIcon, PageIcon } from '@/components/site/page-icon';
import { useAnswerSite, useSiteSearch } from '@/hooks/api/site-search';
import { siteHref } from '@/lib/site-paths';
import { useSiteAnalytics } from '@/providers/site-analytics-provider';

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

export function SiteSearch({
  projectId,
  open,
  onOpenChange,
  lang,
  version,
  placeholder,
  hotkey,
  maxResults,
  languages = [],
  versions = [],
  filtersEnabled = true,
  versionFilterEnabled = true,
  aiAnswers,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lang?: string;
  /** Non-default version path prefix, e.g. "next". Default/latest is undefined. */
  version?: string;
  /** Configured search prompt (config.search.placeholder); falls back to the localized default. */
  placeholder?: string;
  /** Which key opens search (config.search.hotkey): ⌘K (default) or a bare '/'. */
  hotkey?: 'cmdk' | 'slash';
  maxResults?: number;
  languages?: Array<{ code: string; label: string }>;
  versions?: Array<{ id: string; name: string; slug: string; isDefault: boolean }>;
  filtersEnabled?: boolean;
  versionFilterEnabled?: boolean;
  /** Site-level product switch. Instance/provider availability is still
   * enforced server-side and never inferred from this client flag. */
  aiAnswers?: boolean;
}) {
  const { track } = useSiteAnalytics();
  const t = siteT(lang);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'search' | 'answer'>('search');
  const [selectedLanguage, setSelectedLanguage] = useState(lang);
  const [selectedVersion, setSelectedVersion] = useState(version);
  const arabic = selectedLanguage?.toLowerCase().startsWith('ar') ?? false;
  // Debounce the typed query before it feeds the search request, so we don't fire a
  // request per keystroke.
  const [debouncedQuery] = useDebouncedValue(query, { wait: 250 });
  const hitsQuery = useSiteSearch(projectId, debouncedQuery.trim(), selectedLanguage, selectedVersion, maxResults, open && mode === 'search');
  const answerMutation = useAnswerSite();
  const hits = hitsQuery.data ?? [];
  const answer = answerMutation.isPending ? null : (answerMutation.data ?? null);
  const answerError = !answerMutation.isPending && answerMutation.error ? t('answerFailed') : null;
  const searchMessage = !query.trim()
    ? t('searchPrompt')
    : hitsQuery.isFetching
      ? t('searching')
      : hitsQuery.error
        ? t('searchFailed')
        : t('searchEmpty');

  const ask = () => {
    const q = query.trim();
    if (q.length < 2 || answerMutation.isPending) return;
    answerMutation.mutate({
      projectId,
      query: q,
      ...(selectedLanguage ? { language: selectedLanguage } : {}),
      ...(selectedVersion ? { version: selectedVersion } : {}),
    });
  };

  useEffect(() => {
    if (open) {
      setSelectedLanguage(lang);
      setSelectedVersion(version);
    }
  }, [lang, open, version]);

  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null): boolean => {
      const node = el as HTMLElement | null;
      if (!node) {
        return false;
      }
      const tag = node.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || node.isContentEditable;
    };
    const onKey = (event: KeyboardEvent) => {
      // Bare '/' opens search when configured (Mintlify-style), but never while the
      // visitor is typing in a field. Cmd/Ctrl+K always works.
      if (hotkey === 'slash' && event.key === '/' && !event.metaKey && !event.ctrlKey && !isTypingTarget(event.target)) {
        event.preventDefault();
        onOpenChange(true);
        return;
      }
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange, hotkey]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(80vh,720px)] overflow-hidden p-0 sm:max-w-2xl" data-theme-surface="search" showCloseButton={false}>
        <DialogTitle className="sr-only">{t('searchDocumentation')}</DialogTitle>
        <DialogDescription className="sr-only">{t('searchDescription')}</DialogDescription>
        <Command shouldFilter={false}>
          {aiAnswers ? (
            <div className="flex items-center gap-1 border-b px-3 pt-3" role="tablist" aria-label={t('searchMode')}>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'search'}
                className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm ${mode === 'search' ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground'}`}
                onClick={() => setMode('search')}
              >
                <Search className="size-4" /> {t('results')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'answer'}
                className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm ${mode === 'answer' ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground'}`}
                onClick={() => setMode('answer')}
              >
                <Sparkles className="size-4" /> {t('askAi')}
              </button>
            </div>
          ) : null}
          <CommandInput placeholder={placeholder?.trim() || t('searchPlaceholder')} value={query} onValueChange={setQuery} />
          {mode === 'search' && ((filtersEnabled && languages.length > 1) || (versionFilterEnabled && versions.length > 1)) ? (
            <div className="flex flex-col gap-2 border-b px-3 py-2.5 sm:flex-row">
              {filtersEnabled && languages.length > 1 ? (
                <Select onValueChange={(value) => setSelectedLanguage(value ?? undefined)} value={selectedLanguage}>
                  <SelectTrigger aria-label={t('searchFilterLanguage')} className="h-9 min-w-0 flex-1 sm:max-w-56">
                    <SelectValue placeholder={t('searchFilterLanguage')} />
                  </SelectTrigger>
                  <SelectContent>
                    {languages.map((language) => (
                      <SelectItem key={language.code} value={language.code}>
                        {language.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
              {versionFilterEnabled && versions.length > 1 ? (
                <Select
                  onValueChange={(value) => setSelectedVersion(!value || value === '__default' ? undefined : value)}
                  value={selectedVersion ?? '__default'}
                >
                  <SelectTrigger aria-label={t('searchFilterVersion')} className="h-9 min-w-0 flex-1 sm:max-w-56">
                    <SelectValue placeholder={t('searchFilterVersion')} />
                  </SelectTrigger>
                  <SelectContent>
                    {versions.map((item) => (
                      <SelectItem key={item.id} value={item.isDefault ? '__default' : item.slug}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          ) : null}
          {mode === 'search' ? (
            <CommandList>
              <CommandEmpty>{searchMessage}</CommandEmpty>
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
                        language: selectedLanguage,
                      });
                      onOpenChange(false);
                      window.location.href = siteHref(projectId, hit.path, { lang: selectedLanguage, version: selectedVersion });
                    }}
                  >
                    {hasIcon(hit.icon) ? (
                      <PageIcon name={hit.icon} className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0">
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
            </CommandList>
          ) : (
            <div className="max-h-[55vh] overflow-y-auto p-4" dir={arabic ? 'rtl' : 'ltr'}>
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
                <div className="space-y-4">
                  <div className="whitespace-pre-wrap text-sm leading-7" dir={arabic ? 'rtl' : 'ltr'}>
                    {answer.answer}
                  </div>
                  {answer.citations.length > 0 ? (
                    <div className="space-y-2 border-t pt-3">
                      <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground">{t('sources')}</p>
                      {answer.citations.map((citation) => (
                        <a
                          key={citation.id}
                          className="block rounded-md border p-3 text-start transition-colors hover:bg-muted/60"
                          href={siteHref(projectId, citation.path, { lang: selectedLanguage, version: selectedVersion })}
                          dir={citation.direction}
                        >
                          <span className="font-medium text-sm">
                            [{citation.id}] {citation.title}
                          </span>
                          {citation.heading ? <span className="ms-2 text-muted-foreground text-xs">· {citation.heading}</span> : null}
                          <span className="mt-1 line-clamp-2 block text-muted-foreground text-xs">{citation.snippet}</span>
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
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
