import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Language } from '@/hooks/api';
import { useCreateLanguage, useLanguages } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import { LANGUAGE_CATALOG } from '@/lib/languages';

interface AddLanguageDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the newly created language so the editor can switch to it. */
  onCreated: (language: Language) => void;
}

/** Dialog for adding a project language, chosen from a curated catalog (excludes already-added languages). */
export function AddLanguageDialog({ projectId, open, onOpenChange, onCreated }: AddLanguageDialogProps) {
  const t = useT();
  const createLanguage = useCreateLanguage(projectId);
  const { data: existing } = useLanguages(projectId);
  const [code, setCode] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const existingCodes = useMemo(() => new Set((existing ?? []).map((lang) => lang.code)), [existing]);
  const available = useMemo(() => LANGUAGE_CATALOG.filter((lang) => !existingCodes.has(lang.code)), [existingCodes]);

  const handleSubmit = async () => {
    const selected = available.find((lang) => lang.code === code);
    if (!selected) {
      return;
    }
    setSubmitting(true);
    try {
      const language = await createLanguage.mutateAsync({
        code: selected.code,
        label: selected.label,
        direction: selected.rtl ? 'RTL' : 'LTR',
      });
      toast.success(t('editor.addLanguage.added', { label: language.label }));
      onCreated(language);
      onOpenChange(false);
      setCode(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('editor.addLanguage.error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('editor.addLanguage.title')}</DialogTitle>
          <DialogDescription>{t('editor.addLanguage.desc')}</DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lang-select">{t('editor.addLanguage.languageField')}</Label>
            {available.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('editor.addLanguage.allAdded')}</p>
            ) : (
              <Select value={code ?? undefined} onValueChange={(value) => setCode(value as string)}>
                <SelectTrigger id="lang-select" className="w-full">
                  <SelectValue placeholder={t('editor.addLanguage.placeholder')} />
                </SelectTrigger>
                <SelectContent>
                  {available.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      <span>{lang.native}</span>
                      <span className="font-mono text-xs text-muted-foreground">({lang.code})</span>
                      {lang.rtl ? (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                          {t('editor.addLanguage.rtlHint')}
                        </span>
                      ) : null}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={submitting || code === null || available.length === 0}>
              {submitting ? t('editor.addLanguage.adding') : t('editor.addLanguage')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default AddLanguageDialog;
