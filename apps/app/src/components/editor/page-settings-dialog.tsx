import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import type { Page } from '@/hooks/api';
import { useUpdatePage } from '@/hooks/api';
import { useT } from '@/lib/i18n';

/** Per-page settings: slug, icon, description, and visibility — the page metadata
 *  used by the navigation and the published site. */
export function PageSettingsDialog({
  projectId,
  page,
  open,
  onOpenChange,
}: {
  projectId: string;
  page: Page;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const update = useUpdatePage(projectId);
  const [slug, setSlug] = useState(page.slug);
  const [icon, setIcon] = useState(page.icon ?? '');
  const [description, setDescription] = useState(page.description ?? '');
  const [hidden, setHidden] = useState(page.hidden);

  // Re-seed the form from the page each time the dialog opens.
  useEffect(() => {
    if (open) {
      setSlug(page.slug);
      setIcon(page.icon ?? '');
      setDescription(page.description ?? '');
      setHidden(page.hidden);
    }
  }, [open, page]);

  const save = () => {
    update.mutate(
      { pageId: page.id, body: { slug: slug.trim(), icon: icon.trim() || null, description: description.trim() || null, hidden } },
      {
        onSuccess: () => {
          toast.success(t('editor.pageSettings.saved'));
          onOpenChange(false);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : t('editor.pageSettings.saveError')),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('editor.pageSettings.title')}</DialogTitle>
          <DialogDescription>{t('editor.pageSettings.desc')}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="page-slug">{t('editor.pageSettings.slug')}</Label>
            <Input id="page-slug" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="getting-started" />
            <p className="text-muted-foreground text-xs">{t('editor.pageSettings.slugHint')}</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="page-icon">{t('editor.pageSettings.icon')}</Label>
            <Input id="page-icon" value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="rocket" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="page-desc">{t('editor.pageSettings.description')}</Label>
            <Textarea
              id="page-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder={t('editor.pageSettings.descriptionPlaceholder')}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="page-hidden">{t('editor.pageSettings.hidden')}</Label>
              <p className="text-muted-foreground text-xs">{t('editor.pageSettings.hiddenHint')}</p>
            </div>
            <Switch id="page-hidden" checked={hidden} onCheckedChange={setHidden} />
          </div>
        </div>
        <DialogFooter>
          <DialogClose render={<Button type="button" variant="outline" />}>{t('common.cancel')}</DialogClose>
          <Button type="button" onClick={save} disabled={update.isPending}>
            {update.isPending ? t('common.saving') : t('editor.pageSettings.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
