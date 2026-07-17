import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { cn } from '@nibleaf/design-system/lib/utils';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { AddLanguageDialog } from '@/components/editor/add-language-dialog';
import type { Language, Project } from '@/hooks/api';
import { useDeleteLanguage, useLanguages, useUpdateLanguage } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import { SectionHeader, sortLanguagesDefaultFirst } from './shared';

/** A small uppercase chip (direction / default / hidden badges). */
function Chip({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'primary' | 'warning' }) {
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 font-medium text-[10px] uppercase tracking-wide',
        tone === 'primary' && 'bg-primary/10 text-primary',
        tone === 'warning' && 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
        tone === 'muted' && 'bg-muted text-muted-foreground',
      )}
    >
      {children}
    </span>
  );
}

/** Manage the site's languages: add, enable/disable, set the default, delete.
 *  A disabled language stays fully editable in the dashboard but disappears
 *  from every public surface of the published site. The default language can't
 *  be disabled or deleted. */
export function LanguagesSection({ project }: { project: Project }) {
  const t = useT();
  const confirm = useConfirm();
  const { data: languages } = useLanguages(project.id);
  const update = useUpdateLanguage(project.id);
  const remove = useDeleteLanguage(project.id);
  const [addOpen, setAddOpen] = useState(false);

  // Default language always first, then by configured position.
  const rows = sortLanguagesDefaultFirst(languages ?? []);

  const save = async (id: string, body: { enabled?: boolean; isDefault?: boolean }) => {
    try {
      await update.mutateAsync({ id, body });
      toast.success(t('common.saved'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.saveError'));
    }
  };

  const onDelete = async (language: Language) => {
    const ok = await confirm({
      title: t('settings.languages.deleteConfirm.title', { label: language.label }),
      description: t('settings.languages.deleteConfirm.description'),
      confirmLabel: t('settings.languages.delete'),
      destructive: true,
    });
    if (!ok) {
      return;
    }
    try {
      await remove.mutateAsync(language.id);
      toast.success(t('settings.languages.deleted'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('settings.languages.deleteError'));
    }
  };

  return (
    <div>
      <SectionHeader description={t('settings.languages.description')} icon="◫" title={t('settings.languages')} />

      {rows.length > 0 ? (
        <div className="mb-3 overflow-hidden rounded-xl border border-border">
          {rows.map((language) => {
            const enabled = language.enabled !== false;
            return (
              <div className="flex items-center gap-3 border-border border-b p-3.5 last:border-b-0" key={language.id}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-[13.5px]">{language.label}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{language.code}</span>
                    <Chip>{language.direction === 'RTL' ? t('settings.languages.direction.rtl') : t('settings.languages.direction.ltr')}</Chip>
                    {language.isDefault ? <Chip tone="primary">{t('settings.languages.defaultBadge')}</Chip> : null}
                    {!enabled ? <Chip tone="warning">{t('settings.languages.hiddenBadge')}</Chip> : null}
                  </div>
                </div>
                {!language.isDefault ? (
                  <Button
                    className="h-8 cursor-pointer rounded-md px-2.5 text-[12.5px]"
                    onClick={() => void save(language.id, { isDefault: true })}
                    type="button"
                    variant="ghost"
                  >
                    {t('settings.languages.makeDefault')}
                  </Button>
                ) : null}
                <Switch
                  aria-label={t('settings.languages.enabledToggle', { label: language.label })}
                  checked={enabled}
                  disabled={language.isDefault}
                  onCheckedChange={(checked) => void save(language.id, { enabled: checked })}
                />
                {!language.isDefault ? (
                  <button
                    aria-label={t('settings.languages.delete')}
                    className="cursor-pointer text-muted-foreground transition-colors hover:text-destructive"
                    onClick={() => void onDelete(language)}
                    type="button"
                  >
                    <Trash2 className="size-4" />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <button
        className="mb-1.5 flex h-9 cursor-pointer items-center gap-1.5 rounded-[9px] border border-border border-dashed px-3.5 font-medium text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setAddOpen(true)}
        type="button"
      >
        <Plus className="size-3.5" /> {t('settings.languages.add')}
      </button>
      <p className="mt-2 text-[12px] text-muted-foreground leading-snug">{t('settings.languages.hint')}</p>

      <AddLanguageDialog onCreated={() => setAddOpen(false)} onOpenChange={setAddOpen} open={addOpen} projectId={project.id} />
    </div>
  );
}
