import { useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { Project } from '@/hooks/api';
import { useDeleteProject } from '@/hooks/api';
import { SectionHeader } from './shared';

export function DangerSection({ project }: { project: Project }) {
  const del = useDeleteProject();
  const navigate = useNavigate();

  return (
    <div>
      <SectionHeader icon="⚠" title="Danger zone" />

      <div className="mb-3.5 flex items-center gap-3.5 rounded-2xl border border-destructive/30 p-5">
        <p className="flex-1 text-[13.5px] text-muted-foreground leading-relaxed">
          <strong className="text-foreground">Transfer project</strong>
          <br />
          Move this project to another workspace you own.
        </p>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button aria-disabled className="cursor-not-allowed opacity-50" variant="outline">
                  Transfer
                </Button>
              }
            />
            <TooltipContent>Coming soon</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <div className="flex items-center gap-3.5 rounded-2xl border border-destructive/30 p-5">
        <p className="flex-1 text-[13.5px] text-muted-foreground leading-relaxed">
          <strong className="text-destructive">Delete project</strong>
          <br />
          Permanently delete this project, its docs, and analytics. This cannot be undone.
        </p>
        <Button
          className="cursor-pointer"
          onClick={() => {
            if (confirm(`Delete “${project.name}” and all its content? This cannot be undone.`)) {
              del.mutate(project.id, {
                onSuccess: () => {
                  toast.success('Project deleted');
                  navigate({ to: '/app' });
                },
                onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not delete the project'),
              });
            }
          }}
          variant="destructive"
        >
          Delete project
        </Button>
      </div>
    </div>
  );
}
