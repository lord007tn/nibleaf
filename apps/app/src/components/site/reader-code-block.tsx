import { cn } from '@nibleaf/design-system/lib/utils';
import { siteContentT } from '@nibleaf/i18n/site-content';
import { Check, Copy } from 'lucide-react';
import { type ComponentProps, useRef, useState } from 'react';
import { announce } from '@/components/site/reader-content-controls';

/** A code block with a one-click copy button (Mintlify-style). When the fence
 *  carries a `title="…"` (lifted onto the child `<code>` by remarkCodeMeta), a
 *  filename header bar is drawn; otherwise the language shows as a floating badge. */
export function Pre({ locale, ...props }: ComponentProps<'pre'> & { locale?: string }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const t = siteContentT(locale);
  // Language + optional title come from the fence meta. mdast→hast may attach
  // them to this <pre> or to the child <code>, so check both.
  const ownProps = props as ComponentProps<'pre'> & { 'data-title'?: string; 'data-lang'?: string };
  const child = props.children as { props?: { className?: string; 'data-title'?: string; 'data-lang'?: string } } | null | undefined;
  const cls = child?.props?.className ?? '';
  const lang = /language-([\w+#-]+)/.exec(cls)?.[1] ?? ownProps['data-lang'] ?? child?.props?.['data-lang'];
  const title = ownProps['data-title'] ?? child?.props?.['data-title'];
  const copy = async () => {
    setCopied(false);
    setFailed(false);
    try {
      await navigator.clipboard.writeText(ref.current?.textContent ?? '');
      setCopied(true);
      announce(t('copied'));
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setFailed(true);
      announce(t('copyFailed'));
    }
  };
  const copyButton = (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? t('copied') : t('copyCode')}
      className={cn(
        // [direction:ltr] keeps `end-2` physical-right even inside an RTL page,
        // matching the force-LTR code content (else it collides with the badge).
        'reader-code-copy reader-control grid size-7 cursor-pointer place-items-center rounded-md text-white/50 transition-colors [direction:ltr] hover:bg-white/10 hover:text-white/90',
        title ? '' : 'absolute end-2 top-2 z-10 opacity-0 focus-visible:opacity-100 group-hover:opacity-100',
      )}
    >
      {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
    </button>
  );
  return (
    // data-not-typeset: this block owns its own chrome (dark panel, header bar,
    // copy button) — typeset must not restyle the <pre> inside. The wrapper's
    // flow margin tracks the configured rhythm.
    <div
      className="group relative mt-(--typeset-flow) overflow-hidden rounded-xl border border-black/20 bg-[#0d1117] shadow-xs dark:border-white/10"
      data-theme-component="code"
      data-not-typeset
    >
      {title ? (
        <div className="flex items-center justify-between gap-3 border-white/[0.08] border-b bg-white/[0.04] px-4 py-2 [direction:ltr]">
          <span className="truncate font-mono text-[12px] text-white/60">{title}</span>
          <div className="flex shrink-0 items-center gap-2">
            {lang ? <span className="font-mono text-[10px] text-white/50 uppercase">{lang}</span> : null}
            {copyButton}
          </div>
        </div>
      ) : (
        <>
          {lang ? (
            <span className="absolute start-3.5 top-2.5 z-10 font-mono text-[11px] text-white/60 uppercase tracking-wide [direction:ltr]">
              {lang}
            </span>
          ) : null}
          {copyButton}
        </>
      )}
      {/* Announced through the shared live region; the visible hint helps sighted readers copy by hand. */}
      {failed ? <p className="reader-code-copy-failed px-4 py-2 text-sm text-white">{t('copyFailed')}</p> : null}
      <pre
        dir="ltr"
        ref={ref}
        className={cn('overflow-x-auto p-4 text-[13px] leading-relaxed [direction:ltr]', !title && 'reader-code-untitled', !title && lang && 'pt-9')}
        {...props}
      />
    </div>
  );
}
