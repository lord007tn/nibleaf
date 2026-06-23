import { useForm } from '@tanstack/react-form';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { FieldError } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Language } from '@/hooks/api';
import { useCreateLanguage } from '@/hooks/api';
import { required } from '@/lib/form';
import { cn } from '@/lib/utils';

const CODE_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/;

interface AddLanguageDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the newly created language so the editor can switch to it. */
  onCreated: (language: Language) => void;
}

/** Dialog with a TanStack Form for adding a project language (code / label / direction). */
export function AddLanguageDialog({ projectId, open, onOpenChange, onCreated }: AddLanguageDialogProps) {
  const createLanguage = useCreateLanguage(projectId);
  const [direction, setDirection] = useState<'LTR' | 'RTL'>('LTR');

  const form = useForm({
    defaultValues: { code: '', label: '' },
    onSubmit: async ({ value }) => {
      try {
        const language = await createLanguage.mutateAsync({
          code: value.code.trim(),
          label: value.label.trim(),
          direction,
        });
        toast.success(`Added ${language.label}.`);
        onCreated(language);
        onOpenChange(false);
        form.reset();
        setDirection('LTR');
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Could not add the language.');
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a language</DialogTitle>
          <DialogDescription>Create a new localized version of this site's pages.</DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            form.handleSubmit();
          }}
        >
          <form.Field
            name="code"
            validators={{
              onChange: ({ value }) => {
                if (value.trim().length === 0) {
                  return 'Code is required';
                }
                return CODE_RE.test(value.trim()) ? undefined : 'Use a BCP-47 code like "en" or "pt-BR"';
              },
            }}
          >
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lang-code">Code</Label>
                <Input
                  id="lang-code"
                  className="font-mono"
                  placeholder="ar"
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  value={field.state.value}
                />
                <FieldError errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>

          <form.Field name="label" validators={{ onChange: ({ value }) => required('Label')(value) }}>
            {(field) => (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lang-label">Label</Label>
                <Input
                  id="lang-label"
                  placeholder="العربية"
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  value={field.state.value}
                />
                <FieldError errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>

          <div className="flex flex-col gap-1.5">
            <Label>Direction</Label>
            <div className="flex gap-2">
              {(['LTR', 'RTL'] as const).map((dir) => (
                <button
                  type="button"
                  key={dir}
                  onClick={() => setDirection(dir)}
                  className={cn(
                    'flex-1 cursor-pointer rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                    direction === dir
                      ? 'border-primary bg-accent text-accent-foreground'
                      : 'border-border bg-card text-muted-foreground hover:bg-muted',
                  )}
                >
                  {dir === 'LTR' ? 'Left to right' : 'Right to left'}
                  <span className="ms-1.5 font-mono text-xs opacity-70">{dir}</span>
                </button>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <form.Subscribe selector={(state) => state.isSubmitting}>
              {(isSubmitting) => (
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Adding…' : 'Add language'}
                </Button>
              )}
            </form.Subscribe>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default AddLanguageDialog;
