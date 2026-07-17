import { Button } from '@nibleaf/design-system/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nibleaf/design-system/components/ui/dialog';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { cn } from '@nibleaf/design-system/lib/utils';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { Language, LanguageConfig } from '@/hooks/api';
import { useUpdateLanguage } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/lib/i18n/messages';

type Direction = 'LTR' | 'RTL';
type LangSettingsSection = 'general' | 'seo';

const LANG_SETTINGS_SECTIONS = [
  { id: 'general', labelKey: 'editor.langSettings.tab.general', icon: '⊕' },
  { id: 'seo', labelKey: 'editor.langSettings.tab.seo', icon: '◎' },
] as const satisfies ReadonlyArray<{ id: LangSettingsSection; labelKey: MessageKey; icon: string }>;

/** Per-language settings: label, direction, default flag (General) and the SEO
 *  defaults that apply to every page in this language (SEO). The SEO fields
 *  persist to `language.config` and sit between the site and page SEO. Laid out
 *  as a left-sidebar dialog to match the page-settings dialog. */
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
  const [section, setSection] = useState<LangSettingsSection>('general');

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
    // Only persist a config when something is actually overridden (allowIndex
    // defaults to true), otherwise clear it so the language stays config-null.
    // Never send null while the config carries a localized name/description —
    // the server merge only preserves chrome sections on whole-config null, so
    // nulling here would delete them (same guard as LanguageSeoForm).
    const hasOverride = [metaTitle, metaDescription, socialImage].some((v) => v.trim() !== '') || allowIndex === false;
    const keepsName = Boolean(language.config?.name?.trim() || language.config?.description?.trim());
    update.mutate(
      {
        id: language.id,
        body: {
          label: label.trim() || language.label,
          direction,
          ...(isDefault ? { isDefault: true } : {}),
          config: hasOverride || keepsName ? config : null,
        },
      },
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
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogDescription className="sr-only">{t('editor.langSettings.desc')}</DialogDescription>
        <div className="flex h-[min(520px,80vh)]">
          {/* Left settings sidebar */}
          <aside className="flex w-48 shrink-0 flex-col border-border border-e bg-muted/30 p-2.5">
            <DialogHeader className="px-2 pt-1.5 pb-3">
              <DialogTitle className="text-start text-base">{t('editor.langSettings.title')}</DialogTitle>
              <p className="truncate text-muted-foreground text-xs">{language.label}</p>
            </DialogHeader>
            <nav className="flex flex-col gap-0.5">
              {LANG_SETTINGS_SECTIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id)}
                  className={cn(
                    'flex h-9 cursor-pointer items-center gap-2 rounded-md px-2.5 text-start font-medium text-[13.5px] transition-colors',
                    section === item.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  <span className="inline-flex w-4 justify-center text-[13px]">{item.icon}</span>
                  {t(item.labelKey)}
                </button>
              ))}
            </nav>
          </aside>

          {/* Content + footer */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {section === 'general' ? (
                <div className="flex flex-col gap-4">
                  <Field label={t('editor.langSettings.label')} htmlFor="lang-label">
                    <Input id="lang-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="English" />
                  </Field>
                  <Field label={t('editor.langSettings.direction')} htmlFor="lang-dir">
                    <Select value={direction} onValueChange={(v) => setDirection((v as Direction) ?? 'LTR')}>
                      <SelectTrigger id="lang-dir" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="LTR">{t('editor.addLanguage.ltr')}</SelectItem>
                        <SelectItem value="RTL">{t('editor.addLanguage.rtl')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  {/* Already-default can't be toggled off here — set another language default instead. */}
                  <Toggle
                    label={t('editor.langSettings.makeDefault')}
                    hint={t('editor.langSettings.makeDefaultHint')}
                    id="lang-default"
                    checked={isDefault}
                    onCheckedChange={setIsDefault}
                    disabled={language.isDefault}
                  />
                </div>
              ) : null}

              {section === 'seo' ? (
                <div className="flex flex-col gap-4">
                  <Field label={t('editor.langSettings.metaTitle')} hint={t('editor.langSettings.metaTitleHint')} htmlFor="lang-meta-title">
                    <Input id="lang-meta-title" value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} placeholder={language.label} />
                  </Field>
                  <Field label={t('editor.langSettings.metaDescription')} htmlFor="lang-meta-desc">
                    <Textarea id="lang-meta-desc" value={metaDescription} onChange={(e) => setMetaDescription(e.target.value)} rows={2} />
                  </Field>
                  <Field label={t('editor.langSettings.socialImage')} htmlFor="lang-social">
                    <Input id="lang-social" value={socialImage} onChange={(e) => setSocialImage(e.target.value)} placeholder="https://…/cover.png" />
                  </Field>
                  <Toggle
                    label={t('editor.langSettings.allowIndex')}
                    hint={t('editor.langSettings.allowIndexHint')}
                    id="lang-index"
                    checked={allowIndex}
                    onCheckedChange={setAllowIndex}
                  />
                </div>
              ) : null}
            </div>

            <DialogFooter className="border-border border-t px-6 py-3">
              <DialogClose render={<Button type="button" variant="outline" />}>{t('common.cancel')}</DialogClose>
              <Button type="button" onClick={save} disabled={update.isPending}>
                {update.isPending ? t('common.saving') : t('editor.pageSettings.save')}
              </Button>
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
    </div>
  );
}

function Toggle({
  label,
  hint,
  id,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  hint?: string;
  id: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Label htmlFor={id}>{label}</Label>
        {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}
