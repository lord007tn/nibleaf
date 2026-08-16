import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@nibleaf/design-system/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { useDebouncedValue } from '@tanstack/react-pacer';
import { FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { hasIcon, PageIcon } from '@/components/site/page-icon';
import { getData } from '@/hooks/api/client-helpers';
import type { SearchHit } from '@/hooks/api/types';
import { api } from '@/lib/api';
import { siteT } from '@/lib/site-i18n';
import { siteHref } from '@/lib/site-paths';

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
}) {
  const t = siteT(lang);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  // Debounce the typed query before it feeds the search request, so we don't fire a
  // request per keystroke.
  const [debouncedQuery] = useDebouncedValue(query, { wait: 250 });
  useEffect(() => {
    const q = debouncedQuery.trim();
    if (!q) {
      setHits([]);
      return;
    }
    let active = true;
    const loadHits = async () =>
      getData<{ hits: SearchHit[] }>(
        await api.public.sites[':id'].search.$get({
          param: { id: projectId },
          query: { q, ...(maxResults ? { limit: String(maxResults) } : {}), ...(lang ? { lang } : {}), ...(version ? { version } : {}) },
        }),
        'search',
      );
    loadHits()
      .then((result) => {
        if (active) setHits(result.hits);
      })
      .catch(() => {
        if (active) setHits([]);
      });
    return () => {
      active = false;
    };
  }, [debouncedQuery, lang, maxResults, projectId, version]);

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
      <DialogContent className="overflow-hidden p-0" showCloseButton={false}>
        <DialogTitle className="sr-only">{t('searchDocumentation')}</DialogTitle>
        <DialogDescription className="sr-only">{t('searchDescription')}</DialogDescription>
        <Command shouldFilter={false}>
          <CommandInput placeholder={placeholder?.trim() || t('searchPlaceholder')} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{query.trim() ? t('searchEmpty') : t('searchPrompt')}</CommandEmpty>
            <CommandGroup heading={t('results')}>
              {hits.map((hit) => (
                <CommandItem
                  key={hit.id}
                  value={hit.id}
                  onSelect={() => {
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
        </Command>
      </DialogContent>
    </Dialog>
  );
}
