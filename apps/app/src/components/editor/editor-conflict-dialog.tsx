import { Button } from '@nibleaf/design-system/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { useT } from '@nibleaf/i18n/react';
import { useState } from 'react';
import type { ServerSnapshot } from './editor-draft';

/** Manual reconciliation: accepting a base is explicit and never discards a draft. */
export function EditorConflictDialog({
  server,
  draft,
  onResolve,
  onClose,
}: {
  server: ServerSnapshot;
  draft: { title: string; content: string };
  onResolve: (draft: { title: string; content: string }) => void;
  onClose: (draft: { title: string; content: string }) => void;
}) {
  const t = useT();
  const [title, setTitle] = useState(draft.title);
  const [content, setContent] = useState(draft.content);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose({ title, content });
      }}
    >
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{t('editor.conflict.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t('editor.conflict.body')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="conflict-server">{t('editor.conflict.server')}</Label>
            <Input value={server.title} readOnly aria-label={t('editor.pageSettings.pageTitle')} />
            <Textarea id="conflict-server" value={server.content} readOnly rows={12} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="conflict-draft">{t('editor.conflict.local')}</Label>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} aria-label={t('editor.pageSettings.pageTitle')} />
            <Textarea id="conflict-draft" value={content} onChange={(event) => setContent(event.target.value)} rows={12} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onClose({ title, content })}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => onResolve({ title, content })}>{t('editor.conflict.resolve')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
