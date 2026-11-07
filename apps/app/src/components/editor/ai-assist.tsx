import { Button } from '@nibleaf/design-system/components/ui/button';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { ArrowDownToLine, Check, Replace, Sparkles, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAiDraft } from '@/hooks/api';

type AiMode = 'continue' | 'rephrase' | 'outline' | 'summarize';
/** What was clicked: a mode, or Generate with the person's own instruction. */
type AiAction = AiMode | 'instruction';

/** Shown on the clicked button while the assistant works. */
const WORKING: Record<AiAction, MessageKey> = {
  continue: 'editor.ai.drafting',
  rephrase: 'editor.ai.rephrasing',
  outline: 'editor.ai.outlining',
  summarize: 'editor.ai.summarizing',
  instruction: 'editor.ai.drafting',
};

interface AiAssistProps {
  projectId: string;
  /** Current editor content (Markdown source). */
  content: string;
  /** Persisted setter — updating this triggers the editor's autosave. */
  onContentChange: (next: string) => void;
}

/** Append-style modes write straight back into the doc; transform modes show a preview first. */
const APPEND_MODES = new Set<AiMode>(['continue', 'outline']);

/**
 * AI assist card. Calls `useAiDraft(projectId)` with the live editor content.
 * For continue/outline the result is appended to the doc (so autosave persists it);
 * for rephrase/summarize the result lands in a preview box with Replace / Insert actions.
 * The clicked button shows that the assistant is working; a failure is toasted
 * once, in plain words, by `useAiDraft` (meta.errorMessage).
 */
export function AiAssist({ projectId, content, onContentChange }: AiAssistProps) {
  const t = useT();
  const ai = useAiDraft(projectId);
  const [instruction, setInstruction] = useState('');
  const [running, setRunning] = useState<AiAction | null>(null);
  // Preview for transform modes (rephrase/summarize) — kept until the user acts on it.
  const [preview, setPreview] = useState<{ mode: AiMode; text: string } | null>(null);

  const appendToDoc = (text: string) => {
    const trimmed = content.replace(/\s+$/, '');
    const next = trimmed ? `${trimmed}\n\n${text.trim()}` : text.trim();
    onContentChange(next);
  };

  const run = (action: AiAction, instruction?: string) => {
    const mode: AiMode = action === 'instruction' ? 'continue' : action;
    setRunning(action);
    setPreview(null);
    ai.mutate(
      { mode, content, ...(instruction ? { instruction } : {}) },
      {
        onSuccess: (result) => {
          if (!result.text?.trim()) {
            toast.message(t('editor.ai.empty'));
            return;
          }
          if (APPEND_MODES.has(mode)) {
            appendToDoc(result.text);
            toast.success(mode === 'outline' ? t('editor.ai.outlineAdded') : t('editor.ai.sectionDrafted'));
          } else {
            setPreview({ mode, text: result.text });
          }
        },
        onSettled: () => setRunning(null),
      },
    );
  };

  const pending = ai.isPending;

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2.5 border-border border-b px-4 py-3.5">
        <span className="flex size-6 items-center justify-center rounded-md bg-gradient-to-br from-primary to-primary/60 text-primary-foreground">
          <Sparkles className="size-3.5" />
        </span>
        <span className="font-semibold text-sm">{t('editor.ai.title')}</span>
      </div>

      <div className="space-y-3 p-4">
        <p className="text-muted-foreground text-sm leading-relaxed">{t('editor.ai.intro')}</p>

        <div className="space-y-2">
          <Button
            className="w-full justify-start"
            disabled={pending}
            loading={running === 'continue'}
            loadingText={t(WORKING.continue)}
            onClick={() => run('continue')}
          >
            <Sparkles className="size-4" /> {t('editor.ai.continue')}
          </Button>
          <div className="grid grid-cols-1 gap-2">
            <Button
              className="w-full justify-start whitespace-normal text-start leading-snug"
              disabled={pending}
              loading={running === 'rephrase'}
              loadingText={t(WORKING.rephrase)}
              onClick={() => run('rephrase')}
              size="sm"
              variant="outline"
            >
              {t('editor.ai.rephrase')}
            </Button>
            <Button
              className="w-full justify-start whitespace-normal text-start leading-snug"
              disabled={pending}
              loading={running === 'outline'}
              loadingText={t(WORKING.outline)}
              onClick={() => run('outline')}
              size="sm"
              variant="outline"
            >
              {t('editor.ai.outline')}
            </Button>
            <Button
              className="w-full justify-start whitespace-normal text-start leading-snug"
              disabled={pending}
              loading={running === 'summarize'}
              loadingText={t(WORKING.summarize)}
              onClick={() => run('summarize')}
              size="sm"
              variant="outline"
            >
              {t('editor.ai.summarize')}
            </Button>
          </div>
        </div>

        {preview ? (
          <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
            <div className="flex items-center gap-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
              <Wand2 className="size-3" />
              {preview.mode === 'summarize' ? t('editor.ai.summaryLabel') : t('editor.ai.suggestionLabel')}
            </div>
            <p className="max-h-40 overflow-y-auto whitespace-pre-wrap text-foreground/90 text-sm leading-relaxed" dir="auto">
              {preview.text}
            </p>
            <div className="grid grid-cols-1 gap-2">
              <Button
                className="w-full justify-start whitespace-normal text-start"
                onClick={() => {
                  onContentChange(preview.text.trim());
                  setPreview(null);
                  toast.success(t('editor.ai.replaced'));
                }}
                size="sm"
              >
                <Replace className="size-3.5" /> {t('editor.ai.replace')}
              </Button>
              <Button
                className="w-full justify-start whitespace-normal text-start"
                onClick={() => {
                  appendToDoc(preview.text);
                  setPreview(null);
                  toast.success(t('editor.ai.inserted'));
                }}
                size="sm"
                variant="outline"
              >
                <ArrowDownToLine className="size-3.5" /> {t('editor.ai.insert')}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="space-y-2 border-border border-t pt-3">
          <Textarea
            className="min-h-[64px] resize-none text-sm"
            disabled={pending}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder={t('editor.ai.instructionPlaceholder')}
            value={instruction}
          />
          <Button
            className="w-full"
            disabled={pending || !instruction.trim()}
            loading={running === 'instruction'}
            loadingText={t(WORKING.instruction)}
            onClick={() => run('instruction', instruction.trim())}
            variant="secondary"
          >
            <Check className="size-4" />
            {t('editor.ai.generate')}
          </Button>
        </div>
      </div>
    </div>
  );
}
