import { cn } from '@nibleaf/design-system/lib/utils';
import { type RefObject, useLayoutEffect } from 'react';

/**
 * The big page title above the body. A one-line textarea rather than an input
 * so long titles wrap instead of scrolling sideways. It still behaves like a
 * title: Enter moves to the body (it never inserts a line break) and pasted
 * line breaks become spaces.
 */
export function PageTitleField({
  value,
  onChange,
  onEnter,
  label,
  lang,
  textareaRef,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Called on Enter — the editor moves focus to the start of the body. */
  onEnter: () => void;
  label: string;
  lang?: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  className?: string;
}) {
  // Grow with the text. `field-sizing: content` does this natively where it is
  // supported; measuring keeps other browsers in step.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text changes.
  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${element.scrollHeight}px`;
  }, [value, textareaRef]);

  return (
    <textarea
      ref={textareaRef}
      aria-label={label}
      data-page-title=""
      className={cn(
        'block w-full min-w-0 resize-none overflow-hidden rounded-sm border-0 bg-transparent font-semibold text-3xl leading-[1.2] tracking-tight outline-none [field-sizing:content] placeholder:text-muted-foreground/40 focus-visible:ring-2 focus-visible:ring-ring/40 sm:text-[2.1rem]',
        className,
      )}
      dir="auto"
      lang={lang}
      onChange={(event) => onChange(event.target.value.replace(/[\r\n]+/g, ' '))}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          onEnter();
        }
      }}
      placeholder={label}
      rows={1}
      value={value}
    />
  );
}

/** Put the caret at the very start of the page body (visual editor or source). */
export function focusBodyStart(container: HTMLElement | null) {
  if (!container) return;
  const source = container.querySelector<HTMLTextAreaElement>('textarea:not([data-page-title])');
  const prose = container.querySelector<HTMLElement>('.ProseMirror[contenteditable="true"]');
  if (prose) {
    prose.focus();
    const selection = window.getSelection();
    if (selection) {
      const range = document.createRange();
      range.setStart(prose, 0);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    return;
  }
  if (source) {
    source.focus();
    source.setSelectionRange(0, 0);
  }
}
