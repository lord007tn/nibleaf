import { useNavigate } from '@tanstack/react-router';
import { BarChart3, BookText, Plus, Settings } from 'lucide-react';
import { useEffect } from 'react';
import { CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { useProjects } from '@/hooks/api';

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
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
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search projects and actions…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Projects">
          {(projects ?? []).map((project) => (
            <CommandItem
              key={project.id}
              value={`project ${project.name}`}
              onSelect={() => go('/app/projects/$projectId', { projectId: project.id })}
            >
              <BookText className="size-4" />
              {project.name}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Go to">
          <CommandItem value="projects" onSelect={() => go('/app')}>
            <Plus className="size-4" /> All projects
          </CommandItem>
          <CommandItem value="analytics" onSelect={() => go('/app/analytics')}>
            <BarChart3 className="size-4" /> Analytics
          </CommandItem>
          <CommandItem value="settings" onSelect={() => go('/app/settings')}>
            <Settings className="size-4" /> Account settings
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
