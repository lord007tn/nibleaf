import { Button } from '@nibleaf/design-system/components/ui/button';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@nibleaf/design-system/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@nibleaf/design-system/components/ui/dialog';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { ArrowLeft, Plus } from 'lucide-react';
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
  const [custom, setCustom] = useState(false);
  const [customCode, setCustomCode] = useState('');
  const [customLabel, setCustomLabel] = useState('');
  const [customDirection, setCustomDirection] = useState<'LTR' | 'RTL'>('LTR');

  const existingCodes = useMemo(() => new Set((existing ?? []).map((lang) => lang.code.toLowerCase())), [existing]);
  const available = useMemo(() => LANGUAGE_CATALOG.filter((lang) => !existingCodes.has(lang.code.toLowerCase())), [existingCodes]);

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

  const handleCustomAdd = async () => {
    const label = customLabel.trim();
    let code = '';
    try {
      code = Intl.getCanonicalLocales(customCode.trim())[0] ?? '';
    } catch {
      toast.error(t('editor.addLanguage.codeInvalid'));
      return;
    }
    if (!code) {
      toast.error(t('editor.addLanguage.codeRequired'));
      return;
    }
    if (existingCodes.has(code.toLowerCase())) {
      toast.error(t('editor.addLanguage.error'));
      return;
    }
    if (!label) {
      toast.error(t('editor.addLanguage.labelRequired'));
      return;
    }
    await handleAdd({ code, label, native: label, rtl: customDirection === 'RTL' });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-hidden p-0">
        <DialogHeader className="px-4 pt-4">
          <DialogTitle>{t('editor.addLanguage.title')}</DialogTitle>
          <DialogDescription>{t('editor.addLanguage.desc')}</DialogDescription>
        </DialogHeader>

        {custom ? (
          <div className="space-y-4 px-4 pb-4">
            <Button className="px-0" onClick={() => setCustom(false)} size="sm" type="button" variant="link">
              <ArrowLeft className="size-4 rtl:rotate-180" /> {t('editor.addLanguage.backToCatalog')}
            </Button>
            <div className="grid gap-2">
              <Label htmlFor="custom-language-code">{t('editor.addLanguage.codeField')}</Label>
              <Input
                autoCapitalize="none"
                id="custom-language-code"
                onChange={(event) => setCustomCode(event.target.value)}
                placeholder="zh-Hans-CN"
                spellCheck={false}
                value={customCode}
              />
              <p className="text-muted-foreground text-xs">{t('editor.addLanguage.codeInvalid')}</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="custom-language-label">{t('editor.addLanguage.labelField')}</Label>
              <Input id="custom-language-label" onChange={(event) => setCustomLabel(event.target.value)} value={customLabel} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="custom-language-direction">{t('editor.addLanguage.direction')}</Label>
              <Select value={customDirection} onValueChange={(value) => setCustomDirection(value as 'LTR' | 'RTL')}>
                <SelectTrigger id="custom-language-direction">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LTR">{t('editor.addLanguage.ltr')}</SelectItem>
                  <SelectItem value="RTL">{t('editor.addLanguage.rtl')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" disabled={submitting} onClick={() => void handleCustomAdd()} type="button">
              <Plus className="size-4" /> {submitting ? t('editor.addLanguage.adding') : t('editor.addLanguage.title')}
            </Button>
          </div>
        ) : (
          <>
            {available.length === 0 ? (
              <p className="px-4 pt-2 text-muted-foreground text-sm">{t('editor.addLanguage.allAdded')}</p>
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
            <div className="border-border border-t p-2">
              <Button className="w-full justify-start" onClick={() => setCustom(true)} type="button" variant="ghost">
                <Plus className="size-4" /> {t('editor.addLanguage.custom')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default AddLanguageDialog;
