import { Button } from '@nibleaf/design-system/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@nibleaf/design-system/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { siteT } from '@nibleaf/i18n/site';
import { useDebouncedValue } from '@tanstack/react-pacer';
import { AlertCircle, FileText, Loader2, Search, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { hasIcon, PageIcon } from '@/components/site/page-icon';
import { useAnswerSite } from '@/hooks/api/mutations';
import { useSiteSearch } from '@/hooks/api/queries';
import { siteHref } from '@/lib/site-paths';
import { useSiteAnalytics } from '@/providers/site-analytics-provider';

/** Wrap occurrences of the query's words in <mark> so matches stand out. */
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
  let offset = 0;
  return (
    <>
      {text.split(splitRe).map((part) => {
        const key = `${offset}-${part}`;
        offset += part.length;
        return testRe.test(part) ? (
          <mark key={key} className="rounded bg-primary/20 text-foreground">
            {part}
          </mark>
        ) : (
          <span key={key}>{part}</span>
        );
      })}
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
  /** Site-level product switch. Instance/provider availability is still
   * enforced server-side and never inferred from this client flag. */
  aiAnswers?: boolean;
}) {
  const { track } = useSiteAnalytics();
  const t = siteT(lang);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'search' | 'answer'>('search');
  const arabic = lang?.toLowerCase().startsWith('ar') ?? false;
  // Debounce the typed query before it feeds the search request, so we don't fire a
  // request per keystroke.
  const [debouncedQuery] = useDebouncedValue(query, { wait: 250 });
  const hitsQuery = useSiteSearch(projectId, debouncedQuery.trim(), lang, version, maxResults, open && mode === 'search');
  const answerMutation = useAnswerSite();
  const hits = hitsQuery.data ?? [];
  const answer = answerMutation.isPending ? null : (answerMutation.data ?? null);
  const answerError =
    !answerMutation.isPending && answerMutation.error
      ? arabic
        ? 'تعذر إنشاء الإجابة. حاول مرة أخرى لاحقاً.'
        : answerMutation.error instanceof Error
          ? answerMutation.error.message
          : 'Could not generate an answer.'
      : null;
  const searchMessage = !query.trim()
    ? t('searchPrompt')
    : hitsQuery.isFetching
      ? arabic
        ? 'جارٍ البحث…'
        : 'Searching…'
      : hitsQuery.error
        ? arabic
          ? 'تعذر البحث. حاول مرة أخرى.'
          : 'Search failed. Try again.'
        : t('searchEmpty');

  const ask = () => {
    const q = query.trim();
    if (q.length < 2 || answerMutation.isPending) return;
    answerMutation.mutate({ projectId, query: q, ...(lang ? { language: lang } : {}), ...(version ? { version } : {}) });
  };

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
      <DialogContent className="max-h-[min(80vh,720px)] overflow-hidden p-0 sm:max-w-2xl" showCloseButton={false}>
        <DialogTitle className="sr-only">{t('searchDocumentation')}</DialogTitle>
        <DialogDescription className="sr-only">{t('searchDescription')}</DialogDescription>
        <Command shouldFilter={false}>
          {aiAnswers ? (
            <div className="flex items-center gap-1 border-b px-3 pt-3" role="tablist" aria-label={arabic ? 'وضع البحث' : 'Search mode'}>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'search'}
                className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm ${mode === 'search' ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground'}`}
                onClick={() => setMode('search')}
              >
                <Search className="size-4" /> {arabic ? 'النتائج' : 'Results'}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'answer'}
                className={`flex items-center gap-2 border-b-2 px-3 py-2 text-sm ${mode === 'answer' ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground'}`}
                onClick={() => setMode('answer')}
              >
                <Sparkles className="size-4" /> {arabic ? 'اسأل الذكاء الاصطناعي' : 'Ask AI'}
              </button>
            </div>
          ) : null}
          <CommandInput placeholder={placeholder?.trim() || t('searchPlaceholder')} value={query} onValueChange={setQuery} />
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
                        language: lang,
                      });
                      onOpenChange(false);
                      window.location.href = siteHref(projectId, hit.path, { lang, version });
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
                  <p className="font-medium">{arabic ? 'إجابة موثقة من وثائق هذا الموقع' : 'A grounded answer from this site’s documentation'}</p>
                  <p className="mt-1 text-muted-foreground">
                    {arabic
                      ? 'لن تُستخدم أي صفحة لا يسمح لك بقراءتها، وستظهر الاستشهادات مع الإجابة.'
                      : 'Pages you cannot read are excluded, and citations are shown with the answer.'}
                  </p>
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
                      <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground">{arabic ? 'المصادر' : 'Sources'}</p>
                      {answer.citations.map((citation) => (
                        <a
                          key={citation.id}
                          className="block rounded-md border p-3 text-start transition-colors hover:bg-muted/60"
                          href={siteHref(projectId, citation.path, { lang, version })}
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
                <p className="text-muted-foreground text-xs">
                  {arabic ? 'قد لا تتوفر إجابة عندما لا تدعمها الوثائق.' : 'No answer is returned when the docs do not support one.'}
                </p>
                <Button disabled={query.trim().length < 2 || answerMutation.isPending} onClick={ask} size="sm" type="button">
                  {answerMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {answerMutation.isPending ? (arabic ? 'جارٍ التحقق…' : 'Checking…') : arabic ? 'إجابة' : 'Answer'}
                </Button>
              </div>
            </div>
          )}
        </Command>
      </DialogContent>
    </Dialog>
  );
}
