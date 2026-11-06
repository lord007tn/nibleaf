import { Button } from '@nibleaf/design-system/components/ui/button';
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@nibleaf/design-system/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { SkeletonListRow, SkeletonText } from '@nibleaf/design-system/components/ui/skeleton';
import { cn } from '@nibleaf/design-system/lib/utils';
import { siteT } from '@nibleaf/i18n/site';
import { useDebouncedValue } from '@tanstack/react-pacer';
import { useRouter } from '@tanstack/react-router';
import { AlertCircle, ArrowLeft, Clock, CornerDownLeft, FileText, Hash, Loader2, RotateCcw, Search, Sparkles } from 'lucide-react';
import { Fragment, lazy, type ReactNode, type RefObject, Suspense, useEffect, useId, useRef, useState } from 'react';
import { hasIcon, PageIcon } from '@/components/site/page-icon';
import { useAnswerSite, useSiteSearch } from '@/hooks/api/site-search';
import type { SiteSearchHit } from '@/hooks/api/types';
import { LANGUAGE_CATALOG } from '@/lib/languages';
import { siteHref, siteLanguageParam } from '@/lib/site-paths';
import { readSiteStorage, writeSiteStorage } from '@/lib/site-storage';
import { resolveReaderDirection } from '@/lib/text-direction';
import { useSiteAnalytics } from '@/providers/site-analytics-provider';

const SiteSearchAnswer = lazy(() => import('./site-search-answer'));

const RECENT_LIMIT = 5;
const recentKey = (projectId: string) => `nibleaf:site-search:recent:${projectId}`;

const readRecent = (projectId: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(readSiteStorage('localStorage', recentKey(projectId)) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.trim() !== '').slice(0, RECENT_LIMIT)
      : [];
  } catch {
    return [];
  }
};

/** A page the reader can jump to before typing (the first pages of the sidebar). */
export interface SiteSearchSuggestion {
  title: string;
  path: string;
  icon?: string | null;
  /** API-reference pages belong to no docs version, so their link carries none. */
  versionIndependent?: boolean;
}

// Mirrors normalizeArabicSearchText in @nibleaf/search: diacritics and tatweel
// drop out, alef forms and alef maqsura fold, so the words search matched on the
// server are the words highlighted here (e.g. "الغاء" marks "إلغاء").
const ARABIC_MARKS = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]/;
const ARABIC_LETTER = /[\u0621-\u064a\u0671-\u06d3]/;
const foldChar = (char: string): string =>
  ARABIC_MARKS.test(char)
    ? ''
    : char
        .replace(/[\u0622\u0623\u0625\u0671]/, '\u0627')
        .replace('\u0649', '\u064a')
        .toLowerCase();

/** Wrap occurrences of the query's words in <mark> so matches stand out. */
function Highlight({ text, query }: { text: string; query: string }) {
  const tokens = [
    ...new Set(
      query
        .trim()
        .split(/\s+/)
        .map((token) => [...token].map(foldChar).join('')),
    ),
  ].filter((token) => token.length >= 2);
  if (tokens.length === 0) {
    return <>{text}</>;
  }
  // Fold the text while remembering which original character each folded one came from.
  let folded = '';
  const origin: number[] = [];
  for (let index = 0; index < text.length; index += 1) {
    for (const char of foldChar(text[index] ?? '')) {
      folded += char;
      origin.push(index);
    }
  }
  const ranges: Array<[number, number]> = [];
  for (const token of tokens) {
    for (let at = folded.indexOf(token); at !== -1; at = folded.indexOf(token, at + token.length)) {
      let start = origin[at] ?? 0;
      let end = (origin[at + token.length - 1] ?? text.length - 1) + 1;
      // Keep trailing diacritics with their letter.
      while (end < text.length && ARABIC_MARKS.test(text[end] ?? '')) end += 1;
      // Arabic letters join: a mark inside a word (اشتراك in الاشتراك) would break the
      // lam-alef ligature and letter joining, so Arabic matches cover the whole word.
      if (ARABIC_LETTER.test(text[start] ?? '')) {
        while (start > 0 && (ARABIC_LETTER.test(text[start - 1] ?? '') || ARABIC_MARKS.test(text[start - 1] ?? ''))) start -= 1;
        while (end < text.length && (ARABIC_LETTER.test(text[end] ?? '') || ARABIC_MARKS.test(text[end] ?? ''))) end += 1;
      }
      ranges.push([start, end]);
    }
  }
  if (ranges.length === 0) {
    return <>{text}</>;
  }
  ranges.sort((left, right) => left[0] - right[0]);
  const parts: Array<{ start: number; value: string; marked: boolean }> = [];
  let cursor = 0;
  for (const [rangeStart, rangeEnd] of ranges) {
    if (rangeEnd <= cursor) continue;
    const from = Math.max(rangeStart, cursor);
    if (from > cursor) parts.push({ start: cursor, value: text.slice(cursor, from), marked: false });
    parts.push({ start: from, value: text.slice(from, rangeEnd), marked: true });
    cursor = rangeEnd;
  }
  if (cursor < text.length) parts.push({ start: cursor, value: text.slice(cursor), marked: false });
  return (
    <>
      {parts.map(({ start: offset, value, marked }) =>
        marked ? (
          <mark key={offset} className="rounded-[3px] bg-primary/15 px-px font-semibold text-inherit">
            {value}
          </mark>
        ) : (
          <span key={offset}>{value}</span>
        ),
      )}
    </>
  );
}

/** Keyboard key chip. Keys read left-to-right even inside an RTL dialog. */
function Key({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      dir="ltr"
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-border bg-background px-1 font-medium font-sans text-[11px] text-muted-foreground shadow-[0_1px_0] shadow-border',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** Shown on the highlighted row so keyboard users see what Enter does. */
function EnterHint() {
  return (
    <span aria-hidden className="ms-auto hidden shrink-0 self-center group-data-[selected=true]/command-item:inline-flex pointer-coarse:hidden!">
      <Key>
        <CornerDownLeft className="size-3" />
      </Key>
    </span>
  );
}

function RowIcon({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid size-8 shrink-0 place-items-center rounded-md border border-border/80 bg-background text-muted-foreground group-data-[selected=true]/command-item:border-primary/30 group-data-[selected=true]/command-item:text-primary',
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Queries phrased as questions default to "Ask AI"; keywords default to the best page. */
// Arabic ما / من alone also start ordinary titles ("من نحن", About us), so only
// ما هو/هي and من هو/هي count as question openers.
const QUESTION =
  /[?؟]\s*$|^(how|what|why|when|where|who|which|can|could|does|do|is|are|should|will|كيف|ماذا|لماذا|هل|متى|أين|اين|ما هو|ما هي|من هو|من هي)\s/i;

const ROW = 'group/command-item min-h-11 gap-3 rounded-lg px-2.5 py-2 text-foreground data-selected:text-foreground';
const GROUP = 'p-1.5 **:[[cmdk-group-heading]]:px-2.5 **:[[cmdk-group-heading]]:pt-2 **:[[cmdk-group-heading]]:pb-1.5';

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
  onAskAi,
  suggestions = [],
  initialQuery = '',
  returnFocus,
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
  /** Shows the built-in "Ask AI" answer view: the site enables AI answers and
   * the instance can serve them. The answer endpoint still enforces both
   * server-side. Ignored when `onAskAi` is provided. */
  aiAnswers?: boolean;
  /** Hands the reader's question to an external assistant (e.g. a chat panel).
   * When provided, the "Ask AI about …" row closes search and calls this
   * instead of opening the built-in answer view. */
  onAskAi?: (question: string) => void;
  /** Pages offered before the reader types and when nothing matches. */
  suggestions?: SiteSearchSuggestion[];
  /** Text typed into the lightweight input shown while this dialog's code loaded. */
  initialQuery?: string;
  /** Where focus goes when search closes (the element focused before it opened). */
  returnFocus?: RefObject<HTMLElement | null>;
}) {
  const { track } = useSiteAnalytics();
  const router = useRouter();
  const t = siteT(lang);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  // cmdk re-selects the first row whenever the list changes. Only highlight
  // moves made by the reader (keys or pointer) are kept; otherwise the best
  // page result stays highlighted even though "Ask AI" is listed above it.
  const readerMovedRef = useRef(false);
  const markReaderMove = () => {
    readerMovedRef.current = true;
    queueMicrotask(() => {
      readerMovedRef.current = false;
    });
  };
  const [query, setQuery] = useState(initialQuery);
  // Text typed before the dialog loaded keeps its caret at the end; a reopened
  // dialog selects its old query so typing starts a new search.
  const keepCaretRef = useRef(initialQuery !== '');
  const [requestedMode, setMode] = useState<'search' | 'answer'>('search');
  const askAiAvailable = Boolean(onAskAi) || Boolean(aiAnswers);
  // An external assistant replaces the built-in answer view entirely.
  const mode = aiAnswers && !onAskAi ? requestedMode : 'search';
  const baseId = useId();
  const [selectedVersion, setSelectedVersion] = useState(version);
  const [recent, setRecent] = useState<string[]>([]);
  const [activeItem, setActiveItem] = useState('');
  const baseLanguage = lang?.toLowerCase().split(/[-_]/)[0];
  const rtl = resolveReaderDirection(direction, lang) === 'rtl';
  const versionOptions = versions.map((item) => ({ value: item.isDefault ? '__default' : item.slug, label: item.name }));
  const showVersionFilter = mode === 'search' && versionFilterEnabled && versions.length > 1;
  // Debounce the typed query before it feeds the search request, so we don't fire a
  // request per keystroke.
  const [debouncedQuery] = useDebouncedValue(query, { wait: 250 });
  const trimmed = query.trim();
  // Keyword search is intentionally language-independent. Omitting `language`
  // asks the public endpoint to search every enabled language in the published
  // snapshot; each hit carries its own language for correct localized routing.
  const hitsQuery = useSiteSearch(projectId, debouncedQuery.trim(), undefined, selectedVersion, maxResults, open && mode === 'search');
  const answerMutation = useAnswerSite();
  // Pending: what's on screen doesn't answer the typed text yet. While the next
  // query loads, the last results stay in place, dimmed and inert (the query
  // keeps previous data), so the list doesn't flash empty on every keystroke.
  // A background refetch of the same query, or a retry after an error, keeps its
  // own content in place.
  const queryPending =
    Boolean(trimmed) &&
    (trimmed !== debouncedQuery.trim() || hitsQuery.isPlaceholderData || (hitsQuery.isFetching && hitsQuery.data === undefined && !hitsQuery.error));
  const searchFailed = Boolean(trimmed && !queryPending && hitsQuery.error);
  const hits: SiteSearchHit[] = trimmed && !hitsQuery.error ? (hitsQuery.data ?? []) : [];
  const staleHits = queryPending && hits.length > 0;
  const noResults = Boolean(trimmed && !queryPending && !hitsQuery.error && hits.length === 0);
  const canAsk = askAiAvailable && trimmed.length >= 2;
  // A completed request belongs to the exact question and documentation scope
  // that produced it. Editing the query or version must never relabel old
  // evidence or send its citations into a different version.
  const answerMatchesScope =
    answerMutation.variables?.projectId === projectId &&
    answerMutation.variables.query === trimmed &&
    answerMutation.variables.language === lang &&
    answerMutation.variables.version === selectedVersion;
  const answer = answerMatchesScope && !answerMutation.isPending ? (answerMutation.data ?? null) : null;
  const answerError = answerMatchesScope && !answerMutation.isPending && answerMutation.error ? t('answerFailed') : null;

  const remember = (value: string) => {
    const entry = value.trim();
    if (entry.length < 2) return;
    const next = [entry, ...readRecent(projectId).filter((item) => item.toLowerCase() !== entry.toLowerCase())].slice(0, RECENT_LIMIT);
    writeSiteStorage('localStorage', recentKey(projectId), JSON.stringify(next));
    setRecent(next);
  };

  const clearRecent = () => {
    writeSiteStorage('localStorage', recentKey(projectId), '[]');
    setRecent([]);
    inputRef.current?.focus();
  };

  const ask = () => {
    if (trimmed.length < 2 || answerMutation.isPending) return;
    answerMutation.mutate({
      projectId,
      query: trimmed,
      // Answers stay in the reader's current language even though ordinary
      // results search the whole multilingual corpus.
      ...(lang ? { language: lang } : {}),
      ...(selectedVersion ? { version: selectedVersion } : {}),
    });
  };

  const askAi = () => {
    if (!canAsk) return;
    remember(trimmed);
    if (onAskAi) {
      onOpenChange(false);
      onAskAi(trimmed);
      return;
    }
    setMode('answer');
    if (!answerMatchesScope || answerMutation.error) ask();
  };

  const openPage = (
    path: string,
    language: string | undefined,
    analytics?: { hit: SiteSearchHit; position: number },
    options?: { versionIndependent?: boolean },
  ) => {
    if (analytics) {
      track({
        name: 'search_result_clicked',
        path: analytics.hit.path,
        resultId: analytics.hit.id,
        resultPosition: analytics.position,
        language: analytics.hit.language,
      });
      remember(debouncedQuery);
    }
    onOpenChange(false);
    void router.navigate({
      href: siteHref(projectId, path, {
        lang: siteLanguageParam(language ?? lang ?? defaultLanguage ?? '', defaultLanguage),
        version: options?.versionIndependent ? undefined : selectedVersion,
      }),
    });
  };

  useEffect(() => {
    if (!open) return;
    setSelectedVersion(version);
    setRecent(readRecent(projectId));
    const frame = requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      if (keepCaretRef.current) {
        keepCaretRef.current = false;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
      } else {
        input.select();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [open, version, projectId]);

  // Ordered values of every selectable row, matching render order. For a
  // keyword query the first page result starts highlighted so Enter opens the
  // best match, with "Ask AI" one ↑ above it; a question starts on "Ask AI".
  const askValue = 'ask-ai';
  // Suggestions come from the current version's sidebar, so they only apply while
  // the reader searches that version.
  const visibleSuggestions = selectedVersion === version ? suggestions : [];
  const suggestionValues = visibleSuggestions.map((_, index) => `suggest-${index}`);
  const itemValues: string[] = [];
  if (!trimmed) {
    itemValues.push(...recent.map((_, index) => `recent-${index}`));
    if (recent.length > 0) itemValues.push('recent-clear');
    itemValues.push(...suggestionValues);
  } else if (staleHits) {
    // Dimmed results can't be chosen; Enter waits for the new ones.
    if (canAsk) itemValues.push(askValue);
  } else if (hits.length > 0) {
    if (canAsk) itemValues.push(askValue);
    for (const [index, hit] of hits.entries()) {
      itemValues.push(`page-${index}`);
      if (hit.section) itemValues.push(`section-${index}`);
    }
  } else if (noResults) {
    if (canAsk) itemValues.push(askValue);
    itemValues.push(...suggestionValues);
  }
  const preferred =
    canAsk && QUESTION.test(trimmed) && itemValues.includes(askValue) ? askValue : itemValues.includes('page-0') ? 'page-0' : itemValues[0];
  const selectedValue = itemValues.includes(activeItem) ? activeItem : (preferred ?? '');
  // Re-select through cmdk's own pointer path so its internal selection and
  // the input's aria-activedescendant follow (a controlled value alone does not).
  // Relies on cmdk 1.x items selecting themselves on pointermove; the "highlights
  // the best page first" test fails if a cmdk upgrade changes that.
  const restoreSelection = (value: string) => {
    listRef.current?.querySelector(`[cmdk-item][data-value="${value}"]`)?.dispatchEvent(new Event('pointermove', { bubbles: true }));
  };
  // Reset the highlight to the best match whenever a new result set arrives.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only a new result set or query resets the highlight.
  useEffect(() => {
    setActiveItem('');
  }, [hitsQuery.data, debouncedQuery]);

  const statusMessage =
    mode === 'answer'
      ? answerMutation.isPending
        ? t('checking')
        : ''
      : !trimmed
        ? ''
        : queryPending
          ? t('searching')
          : searchFailed
            ? ''
            : hits.length > 0
              ? t('searchResultCount', { count: hits.length })
              : t('searchNoResultsFor', { query: trimmed });

  const languageName = (code: string) => {
    const base = code.toLowerCase().split(/[-_]/)[0];
    return LANGUAGE_CATALOG.find((language) => language.code.toLowerCase() === code.toLowerCase() || language.code === base)?.native ?? code;
  };

  const askRow = canAsk ? (
    <CommandGroup className={GROUP}>
      <CommandItem value={askValue} onSelect={askAi} className={cn(ROW, 'bg-primary/[0.04] data-selected:bg-primary/10')}>
        <RowIcon className="border-primary/25 bg-primary/10 text-primary">
          <Sparkles className="size-4" />
        </RowIcon>
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium" dir="auto">
            {t('searchAskAiAbout', { query: trimmed })}
          </div>
          <div className="truncate text-muted-foreground text-xs">{t('searchAskAiHint')}</div>
        </div>
        <EnterHint />
      </CommandItem>
    </CommandGroup>
  ) : null;

  const suggestionGroup =
    visibleSuggestions.length > 0 ? (
      <CommandGroup heading={t('searchSuggested')} className={GROUP}>
        {visibleSuggestions.map((suggestion, index) => (
          <CommandItem
            key={suggestion.path}
            value={`suggest-${index}`}
            onSelect={() => openPage(suggestion.path, lang, undefined, { versionIndependent: suggestion.versionIndependent })}
            className={ROW}
          >
            <RowIcon>{hasIcon(suggestion.icon) ? <PageIcon name={suggestion.icon} className="size-4" /> : <FileText className="size-4" />}</RowIcon>
            <span className="min-w-0 flex-1 truncate" dir="auto">
              {suggestion.title}
            </span>
            <EnterHint />
          </CommandItem>
        ))}
      </CommandGroup>
    ) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          // Phones: a full-screen sheet so the keyboard never covers results.
          'inset-0 top-0 start-0 flex h-dvh max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 ring-0 rtl:translate-x-0',
          // Larger screens: a panel anchored near the top, so it grows downward
          // as results arrive instead of jumping around the center.
          'sm:inset-auto sm:start-1/2 sm:top-[12vh] sm:h-auto sm:max-h-[min(76vh,680px)] sm:max-w-2xl sm:-translate-x-1/2 sm:rounded-xl sm:shadow-2xl sm:ring-1 sm:rtl:translate-x-1/2',
        )}
        data-theme-surface="search"
        dir={rtl ? 'rtl' : 'ltr'}
        showCloseButton={false}
        finalFocus={returnFocus ?? true}
      >
        <DialogTitle className="sr-only">{t('searchDocumentation')}</DialogTitle>
        <DialogDescription className="sr-only">{t('searchDescription')}</DialogDescription>
        <Command
          shouldFilter={false}
          label={t('searchDocumentation')}
          value={selectedValue}
          onValueChange={(value) => {
            if (readerMovedRef.current) setActiveItem(value);
            else if (value !== selectedValue) queueMicrotask(() => restoreSelection(selectedValue));
          }}
          onKeyDown={(event) => {
            if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key) || (event.ctrlKey && ['j', 'k', 'n', 'p'].includes(event.key))) {
              markReaderMove();
            }
          }}
          loop
          className="min-h-0 flex-1 rounded-none! bg-transparent p-0"
        >
          <div
            className={cn(
              'flex shrink-0 items-center gap-1 border-border/70 border-b ps-4 pe-2 pt-[env(safe-area-inset-top)] sm:pe-3',
              // Restyle the shared command input into a borderless, full-width field.
              '[&_[data-slot=command-input-wrapper]]:min-w-0 [&_[data-slot=command-input-wrapper]]:flex-1 [&_[data-slot=command-input-wrapper]]:p-0',
              '[&_[data-slot=input-group]]:h-14 [&_[data-slot=input-group]]:rounded-none! [&_[data-slot=input-group]]:border-0 [&_[data-slot=input-group]]:bg-transparent! [&_[data-slot=input-group]]:ring-0!',
              '[&_[data-slot=input-group-addon]]:hidden',
            )}
          >
            {queryPending && trimmed ? (
              <Loader2 aria-hidden className="size-5 shrink-0 animate-spin text-muted-foreground motion-reduce:animate-none" />
            ) : (
              <Search aria-hidden className="size-5 shrink-0 text-muted-foreground" />
            )}
            <CommandInput
              ref={inputRef}
              placeholder={placeholder?.trim() || t('searchPlaceholder')}
              value={query}
              onValueChange={setQuery}
              maxLength={300}
              enterKeyHint={mode === 'answer' ? 'send' : 'search'}
              className="h-14 px-2 text-base placeholder:text-muted-foreground/80 sm:text-[15px]"
              onKeyDown={(event) => {
                if (mode === 'answer' && event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  ask();
                }
              }}
            />
            {/* Esc closes on keyboards; phones get a plain-language action. */}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              // The visible "Esc" stays in the accessible name (WCAG 2.5.3).
              aria-label={`${t('closeSearch')} (Esc)`}
              aria-keyshortcuts="Escape"
              className="hidden h-8 shrink-0 cursor-pointer items-center rounded-md px-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring sm:inline-flex pointer-coarse:hidden!"
            >
              <Key>Esc</Key>
            </button>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex h-11 shrink-0 cursor-pointer items-center rounded-md px-3 font-medium text-primary text-sm focus-visible:outline-2 focus-visible:outline-ring sm:hidden pointer-coarse:inline-flex!"
            >
              {t('searchCancel')}
            </button>
          </div>

          <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {statusMessage}
          </div>

          {mode === 'search' ? (
            <div aria-busy={queryPending} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
              {/* Messages stay outside the listbox, which may only hold options. */}
              {!trimmed && recent.length === 0 && visibleSuggestions.length === 0 ? (
                <p className="px-6 py-10 text-center text-muted-foreground text-sm">{t('searchPrompt')}</p>
              ) : null}
              {queryPending && !staleHits ? (
                // First results for this search: rows shaped like the results.
                <div aria-hidden className="space-y-1 p-1.5" data-search-skeleton>
                  {['a', 'b', 'c'].map((row) => (
                    <SkeletonListRow key={row} className="min-h-11 rounded-lg px-2.5" />
                  ))}
                </div>
              ) : null}
              {searchFailed ? (
                <div className="flex flex-col items-center gap-3 px-6 py-10 text-center" role="alert">
                  <AlertCircle aria-hidden className="size-6 text-destructive" />
                  <p className="text-sm">{t('searchFailed')}</p>
                  <Button
                    variant="outline"
                    loading={hitsQuery.isFetching}
                    onClick={() => {
                      // The button is disabled while it retries and goes away on success;
                      // keep focus in the field.
                      inputRef.current?.focus();
                      void hitsQuery.refetch?.();
                    }}
                    className="pointer-coarse:min-h-11"
                  >
                    <RotateCcw aria-hidden className="size-3.5" />
                    {t('searchRetry')}
                  </Button>
                </div>
              ) : null}
              {noResults ? (
                <div className="px-6 pt-8 pb-4 text-center">
                  <p className="font-medium text-sm" dir="auto">
                    {t('searchNoResultsFor', { query: trimmed })}
                  </p>
                  <p className="mt-1 text-muted-foreground text-sm">{t('searchNoResultsHint')}</p>
                </div>
              ) : null}
              <CommandList ref={listRef} label={t('results')} className="max-h-none overflow-visible" onPointerMoveCapture={markReaderMove}>
                {!trimmed ? (
                  <>
                    {recent.length > 0 ? (
                      <CommandGroup heading={t('searchRecent')} className={GROUP}>
                        {recent.map((item, index) => (
                          <CommandItem
                            key={item}
                            value={`recent-${index}`}
                            onSelect={() => {
                              setQuery(item);
                              inputRef.current?.focus();
                            }}
                            className={ROW}
                          >
                            <RowIcon>
                              <Clock className="size-4" />
                            </RowIcon>
                            <span className="min-w-0 flex-1 truncate" dir="auto">
                              {item}
                            </span>
                            <EnterHint />
                          </CommandItem>
                        ))}
                        <CommandItem
                          value="recent-clear"
                          onSelect={clearRecent}
                          className={cn(ROW, 'min-h-9 text-muted-foreground text-xs pointer-coarse:min-h-11')}
                        >
                          <RotateCcw aria-hidden className="ms-2.5 size-3.5" />
                          <span className="ms-1.5">{t('searchClearRecent')}</span>
                        </CommandItem>
                      </CommandGroup>
                    ) : null}
                    {suggestionGroup}
                  </>
                ) : hits.length > 0 ? (
                  <>
                    {askRow}
                    <CommandGroup
                      heading={t('searchPages')}
                      className={cn(GROUP, staleHits && 'opacity-55 transition-opacity motion-reduce:transition-none')}
                    >
                      {hits.map((hit, index) => {
                        const otherLanguage = baseLanguage && hit.language.toLowerCase().split(/[-_]/)[0] !== baseLanguage;
                        const analytics = { hit, position: index + 1 };
                        return (
                          <Fragment key={hit.id}>
                            <CommandItem
                              value={`page-${index}`}
                              disabled={staleHits}
                              onSelect={() => openPage(hit.path, hit.language, analytics)}
                              className={ROW}
                            >
                              <RowIcon>
                                {hasIcon(hit.icon) ? <PageIcon name={hit.icon} className="size-4" /> : <FileText className="size-4" />}
                              </RowIcon>
                              <div className="min-w-0 flex-1" dir="auto" lang={hit.language}>
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className="truncate font-medium">
                                    <Highlight text={hit.title} query={debouncedQuery} />
                                  </span>
                                  {otherLanguage ? (
                                    <span className="shrink-0 rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground">
                                      {languageName(hit.language)}
                                    </span>
                                  ) : null}
                                </div>
                                {hit.section ? (
                                  hit.description ? (
                                    <div className="truncate text-muted-foreground text-xs">{hit.description}</div>
                                  ) : null
                                ) : (
                                  <div className="line-clamp-2 text-muted-foreground text-xs leading-5">
                                    <Highlight text={hit.snippet} query={debouncedQuery} />
                                  </div>
                                )}
                              </div>
                              <EnterHint />
                            </CommandItem>
                            {hit.section ? (
                              <CommandItem
                                value={`section-${index}`}
                                disabled={staleHits}
                                onSelect={() => openPage(`${hit.path}#${hit.section?.id}`, hit.language, analytics)}
                                className={cn(ROW, 'ms-7')}
                              >
                                <RowIcon className="size-7">
                                  <Hash className="size-3.5" />
                                </RowIcon>
                                <div className="min-w-0 flex-1" dir="auto" lang={hit.language}>
                                  <div className="truncate font-medium text-[13px]">
                                    <Highlight text={hit.section.title} query={debouncedQuery} />
                                  </div>
                                  <div className="line-clamp-2 text-muted-foreground text-xs leading-5">
                                    <Highlight text={hit.snippet} query={debouncedQuery} />
                                  </div>
                                </div>
                                <EnterHint />
                              </CommandItem>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </CommandGroup>
                  </>
                ) : noResults ? (
                  <>
                    {askRow}
                    {suggestionGroup}
                  </>
                ) : null}
              </CommandList>
            </div>
          ) : (
            <section
              aria-labelledby={`${baseId}-answer-title`}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
              dir={rtl ? 'rtl' : 'ltr'}
            >
              <div className="mb-3 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setMode('search');
                    inputRef.current?.focus();
                  }}
                  className="-ms-2 inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-md px-2 text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground pointer-coarse:h-11"
                >
                  <ArrowLeft aria-hidden className="size-4 rtl:-scale-x-100" />
                  {t('searchBackToResults')}
                </button>
                <h2 id={`${baseId}-answer-title`} className="flex items-center gap-1.5 font-medium text-sm">
                  <Sparkles aria-hidden className="size-4 text-primary" />
                  {t('askAi')}
                </h2>
              </div>
              {!answer && !answerError ? (
                <div aria-busy={answerMutation.isPending} className="rounded-lg border bg-muted/30 p-4 text-sm">
                  <p className="font-medium">{t('groundedAnswerTitle')}</p>
                  <p className="mt-1 text-muted-foreground">{t('groundedAnswerBody')}</p>
                  <Button
                    disabled={trimmed.length < 2}
                    loading={answerMutation.isPending}
                    loadingText={t('checking')}
                    onClick={ask}
                    className="mt-3 pointer-coarse:min-h-11"
                  >
                    <Sparkles aria-hidden className="size-4" />
                    {t('answer')}
                  </Button>
                  {answerMutation.isPending ? <SkeletonText className="mt-5" lines={4} /> : null}
                </div>
              ) : null}
              {answerError ? (
                <div className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm" role="alert">
                  <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <span>{answerError}</span>
                </div>
              ) : null}
              {answer ? (
                <Suspense fallback={null}>
                  <SiteSearchAnswer answer={answer} projectId={projectId} lang={lang} version={selectedVersion} rtl={rtl} />
                </Suspense>
              ) : null}
              <p className="mt-4 border-t pt-3 text-muted-foreground text-xs">{t('noAnswer')}</p>
            </section>
          )}

          {mode === 'search' ? (
            <div
              className={cn(
                'shrink-0 items-center gap-4 border-border/70 border-t px-4 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] text-muted-foreground text-xs',
                // Key hints mean nothing on touch screens; keep the bar only for the version filter there.
                showVersionFilter ? 'flex' : 'hidden sm:flex pointer-coarse:hidden!',
              )}
            >
              <div className="hidden items-center gap-4 sm:flex pointer-coarse:hidden!">
                <span className="inline-flex items-center gap-1.5">
                  <Key>↑</Key>
                  <Key>↓</Key>
                  {t('searchKeysNavigate')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Key>
                    <CornerDownLeft className="size-3" />
                  </Key>
                  {t('searchKeysOpen')}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Key>Esc</Key>
                  {t('searchKeysClose')}
                </span>
              </div>
              {showVersionFilter ? (
                <div className="ms-auto flex items-center gap-2">
                  <span aria-hidden>{t('searchVersionLabel')}</span>
                  <Select
                    items={versionOptions}
                    onValueChange={(value) => setSelectedVersion(!value || value === '__default' ? undefined : value)}
                    value={selectedVersion ?? '__default'}
                  >
                    <SelectTrigger aria-label={t('searchFilterVersion')} size="sm" className="h-8 min-w-24 text-xs pointer-coarse:h-11">
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
            </div>
          ) : null}
        </Command>
      </DialogContent>
    </Dialog>
  );
}
