import { Button } from '@nibleaf/design-system/components/ui/button';
import { cn } from '@nibleaf/design-system/lib/utils';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import type { Language } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import { AddLanguageDialog } from './add-language-dialog';

interface LanguageTabsProps {
  projectId: string;
  languages: Language[];
  activeLanguageId: string | null;
  onSelect: (languageId: string) => void;
  /** Fired after a language is created so the parent can switch to it. */
  onCreated: (language: Language) => void;
}

/**
 * Editor sub-toolbar language controls: a monospace badge for the active language
 * (e.g. "English · LTR"), a segmented control of all languages, and a "+" button
 * that opens the add-language dialog.
 */
export function LanguageTabs({ projectId, languages, activeLanguageId, onSelect, onCreated }: LanguageTabsProps) {
  const t = useT();
  const [dialogOpen, setDialogOpen] = useState(false);
  const active = languages.find((l) => l.id === activeLanguageId) ?? languages[0];

  return (
    <div className="flex items-center gap-3">
      {active ? (
        <span className="whitespace-nowrap font-mono text-[11.5px] text-muted-foreground">
          {active.label} · {active.direction}
        </span>
      ) : null}

      {languages.length > 0 ? (
        <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
          {languages.map((language) => (
            <button
              type="button"
              key={language.id}
              onClick={() => onSelect(language.id)}
              className={cn(
                'flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors',
                language.id === active?.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <span>{language.label}</span>
              <span className="font-mono text-[10px] opacity-70">{language.code}</span>
            </button>
          ))}
        </div>
      ) : null}

      <Button
        aria-label={t('editor.addLanguage')}
        size="icon-xs"
        variant="ghost"
        className="cursor-pointer"
        onClick={() => setDialogOpen(true)}
        title={t('editor.addLanguage')}
      >
        <Plus className="size-3.5" />
      </Button>

      <AddLanguageDialog projectId={projectId} open={dialogOpen} onOpenChange={setDialogOpen} onCreated={onCreated} />
    </div>
  );
}

export default LanguageTabs;
