import { useDebouncedValue } from '@tanstack/react-pacer';
import { useNavigate } from '@tanstack/react-router';
import { FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { hasIcon, PageIcon } from '@/components/site/page-icon';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useSiteSearch } from '@/hooks/api';
import { siteT } from '@/lib/site-i18n';

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
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lang?: string;
}) {
  const t = siteT(lang);
  const [query, setQuery] = useState('');
  // Debounce the typed query before it feeds the search hook, so we don't fire a
  // request per keystroke.
  const [debouncedQuery] = useDebouncedValue(query, { wait: 250 });
  const { data: hits } = useSiteSearch(projectId, debouncedQuery, lang);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0" showCloseButton={false}>
        <DialogTitle className="sr-only">{t('searchDocumentation')}</DialogTitle>
        <DialogDescription className="sr-only">{t('searchDescription')}</DialogDescription>
        <Command shouldFilter={false}>
          <CommandInput placeholder={t('searchPlaceholder')} value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{query.trim() ? t('searchEmpty') : t('searchPrompt')}</CommandEmpty>
            <CommandGroup heading={t('results')}>
              {(hits ?? []).map((hit) => (
                <CommandItem
                  key={hit.id}
                  value={hit.id}
                  onSelect={() => {
                    onOpenChange(false);
                    navigate({ to: '/sites/$projectId/$', params: { projectId, _splat: hit.path }, search: { lang } });
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
