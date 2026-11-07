import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@nibleaf/design-system/components/ui/popover';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { useT } from '@nibleaf/i18n/react';
import { type CodeBlockMeta, parseCodeLines } from '@nibleaf/shared/code-block-meta';
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { Settings2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

const CODE_BLOCK_LANGUAGES = [
  'bash',
  'c',
  'cpp',
  'csharp',
  'css',
  'diff',
  'go',
  'graphql',
  'html',
  'java',
  'javascript',
  'json',
  'kotlin',
  'markdown',
  'mermaid',
  'php',
  'python',
  'ruby',
  'rust',
  'shell',
  'sql',
  'swift',
  'typescript',
  'xml',
  'yaml',
] as const;

/** Per-node controls keep attribute edits bound to this block, even while inputs have focus. */
export function CodeBlockMenu({ editor, node, updateAttributes, getPos }: ReactNodeViewProps) {
  const t = useT();
  const id = useId();
  const block = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const [open, setOpen] = useState(false);
  const options = node.attrs.codeOptions as Partial<CodeBlockMeta> | null;
  const language = String(node.attrs.language ?? '');
  const [highlight, setHighlight] = useState(options?.highlight?.join(', ') ?? '');
  const invalid = parseCodeLines(highlight) === null;
  const update = (patch: Partial<CodeBlockMeta>) => updateAttributes({ codeOptions: { ...options, ...patch } });
  const known = CODE_BLOCK_LANGUAGES.includes(language as (typeof CODE_BLOCK_LANGUAGES)[number]);
  useEffect(() => {
    const closeOutside = () => {
      const pos = getPos();
      const { from, to } = editor.state.selection;
      if (typeof pos !== 'number' || from <= pos || to >= pos + node.nodeSize) {
        restoreFocus.current = false;
        setOpen(false);
      }
    };
    editor.on('selectionUpdate', closeOutside);
    return () => {
      editor.off('selectionUpdate', closeOutside);
    };
  }, [editor, getPos, node.nodeSize]);
  const canonicalHighlight = options?.highlight?.join(', ') ?? '';
  const lastHighlight = useRef(canonicalHighlight);
  useEffect(() => {
    if (canonicalHighlight !== lastHighlight.current) setHighlight(canonicalHighlight);
    lastHighlight.current = canonicalHighlight;
  }, [canonicalHighlight]);
  return (
    <NodeViewWrapper ref={block} className="editor-code-block" data-wrap={options?.wrap ? 'true' : undefined}>
      <div className="editor-code-header" contentEditable={false}>
        <Input
          className="editor-code-title"
          density="compact"
          aria-label={t('editor.codeBlock.title')}
          placeholder={t('editor.codeBlock.titlePlaceholder')}
          value={options?.title ?? ''}
          disabled={!editor.isEditable}
          onChange={(event) => update({ title: event.target.value })}
        />
        <select
          className="editor-code-language"
          dir="ltr"
          aria-label={t('editor.codeBlock.language')}
          value={language}
          disabled={!editor.isEditable}
          onChange={(event) => updateAttributes({ language: event.target.value || null })}
        >
          <option value="">{t('editor.codeBlock.plain')}</option>
          {language && !known ? <option value={language}>{language}</option> : null}
          {CODE_BLOCK_LANGUAGES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <Popover
          modal={false}
          open={open}
          onOpenChange={(next, details) => {
            restoreFocus.current = details.reason === 'escape-key';
            if (next) {
              const pos = getPos();
              if (typeof pos === 'number' && (editor.state.selection.from <= pos || editor.state.selection.to >= pos + node.nodeSize))
                editor.commands.setTextSelection(pos + 1);
            }
            setOpen(next);
          }}
        >
          <PopoverTrigger
            ref={trigger}
            className="editor-code-options-trigger"
            aria-label={t('editor.codeBlock.options')}
            title={t('editor.codeBlock.options')}
            disabled={!editor.isEditable}
          >
            <Settings2 size={16} aria-hidden />
          </PopoverTrigger>
          <PopoverContent
            className="editor-code-options gap-2 p-3 motion-reduce:animate-none motion-reduce:transition-none"
            side="top"
            align="end"
            aria-label={t('editor.codeBlock.options')}
            finalFocus={() => (restoreFocus.current ? trigger.current : false)}
            sideOffset={({ side }) => {
              // When flipped below, clear the whole code block instead of covering its text.
              return side === 'bottom'
                ? Math.max(4, (block.current?.getBoundingClientRect().bottom ?? 0) - (trigger.current?.getBoundingClientRect().bottom ?? 0) + 4)
                : 8;
            }}
          >
            {(['lines', 'wrap', 'nocopy', 'expandable'] as const).map((key) => (
              <div key={key} className="flex min-h-8 items-center justify-between gap-3">
                <Label htmlFor={`${id}-${key}`}>{t(`editor.codeBlock.${key}`)}</Label>
                <Switch id={`${id}-${key}`} size="sm" checked={options?.[key] ?? false} onCheckedChange={(checked) => update({ [key]: checked })} />
              </div>
            ))}
            <Label htmlFor={`${id}-highlight`}>{t('editor.codeBlock.highlight')}</Label>
            <Input
              id={`${id}-highlight`}
              density="compact"
              dir="ltr"
              value={highlight}
              aria-invalid={invalid}
              aria-describedby={invalid ? `${id}-error` : undefined}
              placeholder="1, 3-5"
              onChange={(event) => {
                setHighlight(event.target.value);
                const lines = parseCodeLines(event.target.value);
                if (lines !== null) {
                  lastHighlight.current = lines.join(', ');
                  update({ highlight: lines });
                }
              }}
            />
            {invalid ? (
              <p id={`${id}-error`} role="alert" className="text-destructive text-xs">
                {t('editor.codeBlock.invalidLines')}
              </p>
            ) : null}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer py-1">{t('editor.codeBlock.diffHelp')}</summary>
              <p className="pt-2">{t('editor.codeBlock.diffHint')}</p>
            </details>
          </PopoverContent>
        </Popover>
      </div>
      <pre dir="ltr">
        <NodeViewContent<'code'> as="code" style={{ whiteSpace: options?.wrap ? 'pre-wrap' : 'pre' }} />
      </pre>
    </NodeViewWrapper>
  );
}
