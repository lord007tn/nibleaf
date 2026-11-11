import { cn } from '@nibleaf/design-system/lib/utils';
import { type CSSProperties, type RefObject, useLayoutEffect } from 'react';

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
  placeholder,
  lang,
  textareaRef,
  className,
  style,
  readOnly = false,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Called on Enter — the editor moves focus to the start of the body. */
  onEnter: () => void;
  label: string;
  placeholder: string;
  lang?: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  className?: string;
  /** The project's typography variables (typographyVars), so the title matches the body headings wherever it is rendered. */
  style?: CSSProperties;
  /** Viewers read the title; they cannot change it. */
  readOnly?: boolean;
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
        'pl-page-title block w-full min-w-0 resize-none overflow-hidden rounded-sm border-0 bg-transparent outline-0 [field-sizing:content] placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-ring focus-visible:outline-offset-4',
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
      placeholder={placeholder}
      readOnly={readOnly}
      rows={1}
      style={style}
      wrap="soft"
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
