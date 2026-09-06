import { Button } from '@nibleaf/design-system/components/ui/button';
import { useT } from '@nibleaf/i18n/react';
import { Bold, Code2, Heading2, Italic, Link, List } from 'lucide-react';
import { type ComponentType, type ReactNode, useMemo, useRef } from 'react';

interface MarkdownSourceEditorProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
  dir?: 'ltr' | 'rtl';
  titleSlot?: ReactNode;
}

function MarkdownToolbarButton({ label, icon: Icon, onClick }: { label: string; icon: ComponentType<{ className?: string }>; onClick: () => void }) {
  return (
    <Button
      aria-label={label}
      className="shrink-0"
      onClick={onClick}
      onMouseDown={(event) => event.preventDefault()}
      size="icon-sm"
      title={label}
      type="button"
      variant="ghost"
    >
      <Icon className="size-4" />
    </Button>
  );
}

export function MarkdownSourceEditor({ value, onChange, label, placeholder, dir = 'ltr', titleSlot }: MarkdownSourceEditorProps) {
  const t = useT();
  const gutter = useRef<HTMLPreElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const lines = useMemo(() => Array.from({ length: Math.max(1, value.split('\n').length) }, (_, index) => index + 1).join('\n'), [value]);

  const commit = (next: string, selectionStart: number, selectionEnd: number) => {
    onChange(next);
    requestAnimationFrame(() => {
      textarea.current?.focus();
      textarea.current?.setSelectionRange(selectionStart, selectionEnd);
    });
  };

  const wrapSelection = (before: string, after: string, fallback: string) => {
    const element = textarea.current;
    if (!element) return;
    const { selectionStart, selectionEnd } = element;
    const selected = value.slice(selectionStart, selectionEnd) || fallback;
    const insertion = `${before}${selected}${after}`;
    commit(
      `${value.slice(0, selectionStart)}${insertion}${value.slice(selectionEnd)}`,
      selectionStart + before.length,
      selectionStart + before.length + selected.length,
    );
  };

  const prefixSelectedLines = (prefix: string) => {
    const element = textarea.current;
    if (!element) return;
    const lineStart = value.lastIndexOf('\n', Math.max(0, element.selectionStart - 1)) + 1;
    const nextLine = value.indexOf('\n', element.selectionEnd);
    const lineEnd = nextLine === -1 ? value.length : nextLine;
    const selectedLines = value.slice(lineStart, lineEnd);
    const replacement = selectedLines
      .split('\n')
      .map((line) => `${prefix}${line}`)
      .join('\n');
    commit(`${value.slice(0, lineStart)}${replacement}${value.slice(lineEnd)}`, lineStart, lineStart + replacement.length);
  };

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden bg-card" dir={dir}>
      <div className="shrink-0 border-border border-b bg-background/95 px-2 py-1.5 backdrop-blur">
        <div aria-label={t('editor.mode.markdown')} className="flex min-h-10 items-center gap-0.5 overflow-x-auto" role="toolbar">
          <MarkdownToolbarButton icon={Heading2} label={t('editor.slash.h2.title')} onClick={() => prefixSelectedLines('## ')} />
          <MarkdownToolbarButton icon={Bold} label={t('editor.format.bold')} onClick={() => wrapSelection('**', '**', 'text')} />
          <MarkdownToolbarButton icon={Italic} label={t('editor.format.italic')} onClick={() => wrapSelection('_', '_', 'text')} />
          <MarkdownToolbarButton icon={Link} label={t('editor.format.link')} onClick={() => wrapSelection('[', '](https://)', 'text')} />
          <MarkdownToolbarButton icon={List} label={t('editor.slash.bulletList.title')} onClick={() => prefixSelectedLines('- ')} />
          <MarkdownToolbarButton icon={Code2} label={t('editor.slash.codeBlock.title')} onClick={() => wrapSelection('```\n', '\n```', 'code')} />
        </div>
      </div>
      {titleSlot ? <div className="w-full shrink-0 border-border border-b px-5 py-4 sm:px-7">{titleSlot}</div> : null}
      <div className="flex min-h-0 flex-1 overflow-hidden" dir="ltr">
        <pre
          ref={gutter}
          aria-hidden
          className="m-0 w-14 shrink-0 overflow-hidden border-border border-e bg-muted/45 py-5 pe-3 text-end font-mono text-[12.5px] text-muted-foreground/65 leading-6 select-none"
        >
          {lines}
        </pre>
        <textarea
          ref={textarea}
          aria-label={label}
          // Markdown punctuation and indentation have LTR source semantics even
          // when the prose is Arabic. Keeping the source canvas LTR prevents
          // headings, fences, and list markers from jumping to the visual end.
          dir="ltr"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onScroll={(event) => {
            if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop;
          }}
          spellCheck={false}
          placeholder={placeholder}
          className="min-h-0 min-w-0 flex-1 resize-none overflow-auto bg-transparent p-5 text-left font-mono text-[13.5px] text-foreground leading-6 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30"
        />
      </div>
    </div>
  );
}
