import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@nibleaf/design-system/components/ui/command';
import { useT } from '@nibleaf/i18n/react';
import { useNavigate } from '@tanstack/react-router';
import { BarChart3, BookOpen, BookText, Plus, Settings } from 'lucide-react';
import { useEffect } from 'react';
import { useProjects } from '@/hooks/api';

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT();
  const navigate = useNavigate();
  const { data: projects } = useProjects();

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

  const go = (to: string, params?: Record<string, string>) => {
    onOpenChange(false);
    navigate({ to, params } as never);
  };

  return (
    <CommandDialog description={t('command.dialog.description')} onOpenChange={onOpenChange} open={open} title={t('command.dialog.title')}>
      <CommandInput placeholder={t('command.searchPlaceholder')} />
      <CommandList>
        <CommandEmpty>{t('command.noResults')}</CommandEmpty>
        <CommandGroup heading={t('command.group.projects')}>
          {(projects ?? []).map((project) => (
            <CommandItem
              key={project.id}
              value={`project ${project.name}`}
              onSelect={() => go('/app/projects/$projectId', { projectId: project.id })}
            >
              <BookText className="size-4" />
              <span className="truncate" dir="auto">
                {project.name}
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading={t('command.group.goTo')}>
          {/* cmdk matches the query against `value`/`keywords`, never the rendered
              label, so the localized label must be a keyword to be searchable. */}
          <CommandItem value="projects" keywords={[t('command.allProjects')]} onSelect={() => go('/app')}>
            <Plus className="size-4" /> {t('command.allProjects')}
          </CommandItem>
          <CommandItem value="sites" keywords={[t('nav.sites')]} onSelect={() => go('/app/sites')}>
            <BookOpen className="size-4" /> {t('nav.sites')}
          </CommandItem>
          <CommandItem value="analytics" keywords={[t('command.analytics')]} onSelect={() => go('/app/analytics')}>
            <BarChart3 className="size-4" /> {t('command.analytics')}
          </CommandItem>
          <CommandItem value="settings" keywords={[t('command.accountSettings')]} onSelect={() => go('/app/settings')}>
            <Settings className="size-4" /> {t('command.accountSettings')}
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
