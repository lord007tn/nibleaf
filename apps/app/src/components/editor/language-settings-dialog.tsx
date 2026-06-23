import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import type { Language, LanguageConfig } from '@/hooks/api';
import { useUpdateLanguage } from '@/hooks/api';
import { useT } from '@/lib/i18n';

type Direction = 'LTR' | 'RTL';

/** Per-language settings: label, direction, default flag (General) and the SEO
 *  defaults that apply to every page in this language (SEO). The SEO fields
 *  persist to `language.config` and sit between the site and page SEO. */
export function LanguageSettingsDialog({
  projectId,
  language,
  open,
  onOpenChange,
}: {
  projectId: string;
  language: Language;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useT();
  const update = useUpdateLanguage(projectId);

  const [label, setLabel] = useState(language.label);
  const [direction, setDirection] = useState<Direction>(language.direction);
  const [isDefault, setIsDefault] = useState(language.isDefault);
  const [metaTitle, setMetaTitle] = useState(language.config?.seo?.metaTitle ?? '');
  const [metaDescription, setMetaDescription] = useState(language.config?.seo?.metaDescription ?? '');
  const [socialImage, setSocialImage] = useState(language.config?.seo?.socialImage ?? '');
  const [allowIndex, setAllowIndex] = useState(language.config?.seo?.allowIndex ?? true);

  useEffect(() => {
    if (!open) {
      return;
    }
    setLabel(language.label);
    setDirection(language.direction);
    setIsDefault(language.isDefault);
    setMetaTitle(language.config?.seo?.metaTitle ?? '');
    setMetaDescription(language.config?.seo?.metaDescription ?? '');
    setSocialImage(language.config?.seo?.socialImage ?? '');
    setAllowIndex(language.config?.seo?.allowIndex ?? true);
  }, [open, language]);

  const save = () => {
    const config: LanguageConfig = {
      seo: { metaTitle: metaTitle.trim(), metaDescription: metaDescription.trim(), socialImage: socialImage.trim(), allowIndex },
    };
    update.mutate(
      { id: language.id, body: { label: label.trim() || language.label, direction, ...(isDefault ? { isDefault: true } : {}), config } },
      {
        onSuccess: () => {
          toast.success(t('editor.langSettings.saved'));
          onOpenChange(false);
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : t('editor.langSettings.saveError')),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t('editor.langSettings.title')} · {language.label}
          </DialogTitle>
          <DialogDescription>{t('editor.langSettings.desc')}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general" className="mt-1">
          <TabsList>
            <TabsTrigger value="general">{t('editor.langSettings.tab.general')}</TabsTrigger>
            <TabsTrigger value="seo">{t('editor.langSettings.tab.seo')}</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lang-label">{t('editor.langSettings.label')}</Label>
              <Input id="lang-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="English" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lang-dir">{t('editor.langSettings.direction')}</Label>
              <Select value={direction} onValueChange={(v) => setDirection((v as Direction) ?? 'LTR')}>
                <SelectTrigger id="lang-dir" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LTR">{t('editor.addLanguage.ltr')}</SelectItem>
                  <SelectItem value="RTL">{t('editor.addLanguage.rtl')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="lang-default">{t('editor.langSettings.makeDefault')}</Label>
                <p className="text-muted-foreground text-xs">{t('editor.langSettings.makeDefaultHint')}</p>
              </div>
              {/* Already-default can't be toggled off here — set another language default instead. */}
              <Switch id="lang-default" checked={isDefault} onCheckedChange={setIsDefault} disabled={language.isDefault} />
            </div>
          </TabsContent>

          <TabsContent value="seo" className="mt-4 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lang-meta-title">{t('editor.langSettings.metaTitle')}</Label>
              <Input id="lang-meta-title" value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} />
              <p className="text-muted-foreground text-xs">{t('editor.langSettings.metaTitleHint')}</p>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lang-meta-desc">{t('editor.langSettings.metaDescription')}</Label>
              <Textarea id="lang-meta-desc" value={metaDescription} onChange={(e) => setMetaDescription(e.target.value)} rows={2} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lang-social">{t('editor.langSettings.socialImage')}</Label>
              <Input id="lang-social" value={socialImage} onChange={(e) => setSocialImage(e.target.value)} placeholder="https://…/cover.png" />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="lang-index">{t('editor.langSettings.allowIndex')}</Label>
                <p className="text-muted-foreground text-xs">{t('editor.langSettings.allowIndexHint')}</p>
              </div>
              <Switch id="lang-index" checked={allowIndex} onCheckedChange={setAllowIndex} />
            </div>
          </TabsContent>
        </Tabs>

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
