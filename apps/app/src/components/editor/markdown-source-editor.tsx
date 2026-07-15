import { useMemo, useRef } from 'react';

export function MarkdownSourceEditor({
  value,
  onChange,
  dir = 'ltr',
  label,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  dir?: 'ltr' | 'rtl';
  label: string;
  placeholder: string;
}) {
  const gutter = useRef<HTMLPreElement>(null);
  const lines = useMemo(() => Array.from({ length: Math.max(1, value.split('\n').length) }, (_, index) => index + 1).join('\n'), [value]);
  return (
    <div className="mx-auto mt-5 flex min-h-[60vh] w-full max-w-[920px] overflow-hidden rounded-xl border border-border bg-card shadow-sm" dir="ltr">
      <pre
        ref={gutter}
        aria-hidden
        className="m-0 w-14 shrink-0 overflow-hidden border-border border-e bg-muted/45 py-4 pe-3 text-end font-mono text-[12.5px] text-muted-foreground/65 leading-6 select-none"
      >
        {lines}
      </pre>
      <textarea
        aria-label={label}
        dir={dir}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => {
          if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop;
        }}
        spellCheck={false}
        placeholder={placeholder}
        className="min-h-[60vh] min-w-0 flex-1 resize-none overflow-auto bg-transparent p-4 font-mono text-[13.5px] text-foreground leading-6 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30"
      />
    </div>
  );
}
