import { useDebouncedValue } from '@tanstack/react-pacer';
import { useNavigate } from '@tanstack/react-router';
import { FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useSiteSearch } from '@/hooks/api';

export function SiteSearch({ projectId, open, onOpenChange, lang }: { projectId: string; open: boolean; onOpenChange: (open: boolean) => void; lang?: string }) {
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
        <DialogTitle className="sr-only">Search documentation</DialogTitle>
        <DialogDescription className="sr-only">Full-text and fuzzy search across this site.</DialogDescription>
        <Command shouldFilter={false}>
          <CommandInput placeholder="Search documentation…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>{query.trim() ? 'No results.' : 'Type to search…'}</CommandEmpty>
            <CommandGroup heading="Results">
              {(hits ?? []).map((hit) => (
                <CommandItem
                  key={hit.id}
                  value={hit.id}
                  onSelect={() => {
                    onOpenChange(false);
                    navigate({ to: '/sites/$projectId/$', params: { projectId, _splat: hit.path }, search: { lang } });
                  }}
                >
                  <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="font-medium">{hit.title}</div>
                    <div className="truncate text-muted-foreground text-xs">{hit.snippet}</div>
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
