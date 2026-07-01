import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@midad/design-system/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@midad/design-system/components/ui/dialog';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { Language } from '@/hooks/api';
import { useCreateLanguage, useLanguages } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import { type CatalogLanguage, LANGUAGE_CATALOG } from '@/lib/languages';

interface AddLanguageDialogProps {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the newly created language so the editor can switch to it. */
  onCreated: (language: Language) => void;
}

/** Dialog for adding a project language: a searchable combobox over a curated
 *  catalog (filter by native name, English name, or code), excluding already-added
 *  languages. Picking a language adds it immediately. */
export function AddLanguageDialog({ projectId, open, onOpenChange, onCreated }: AddLanguageDialogProps) {
  const t = useT();
  const createLanguage = useCreateLanguage(projectId);
  const { data: existing } = useLanguages(projectId);
  const [submitting, setSubmitting] = useState(false);

  const existingCodes = useMemo(() => new Set((existing ?? []).map((lang) => lang.code)), [existing]);
  const available = useMemo(() => LANGUAGE_CATALOG.filter((lang) => !existingCodes.has(lang.code)), [existingCodes]);

  const handleAdd = async (lang: CatalogLanguage) => {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    try {
      const language = await createLanguage.mutateAsync({ code: lang.code, label: lang.label, direction: lang.rtl ? 'RTL' : 'LTR' });
      toast.success(t('editor.addLanguage.added', { label: language.label }));
      onCreated(language);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('editor.addLanguage.error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>{t('editor.addLanguage.title')}</DialogTitle>
          <DialogDescription>{t('editor.addLanguage.desc')}</DialogDescription>
        </DialogHeader>

        {available.length === 0 ? (
          <p className="px-4 pt-2 pb-4 text-muted-foreground text-sm">{t('editor.addLanguage.allAdded')}</p>
        ) : (
          <Command className="rounded-none bg-transparent">
            <CommandInput placeholder={t('editor.addLanguage.searchPlaceholder')} />
            <CommandList className="max-h-72 pb-1">
              <CommandEmpty>{t('editor.addLanguage.noResults')}</CommandEmpty>
              <CommandGroup>
                {available.map((lang) => (
                  <CommandItem
                    key={lang.code}
                    // Search across native name, English name, and code.
                    value={`${lang.label} ${lang.native} ${lang.code}`}
                    onSelect={() => void handleAdd(lang)}
                    disabled={submitting}
                  >
                    <span className="font-medium">{lang.native}</span>
                    <span className="text-muted-foreground text-sm">{lang.label}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{lang.code}</span>
                    {lang.rtl ? (
                      <span className="ms-1 rounded bg-muted px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground uppercase">
                        {t('editor.addLanguage.rtlHint')}
                      </span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default AddLanguageDialog;
