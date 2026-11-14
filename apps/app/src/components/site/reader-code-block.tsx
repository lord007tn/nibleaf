import { cn } from '@nibleaf/design-system/lib/utils';
import { siteContentT } from '@nibleaf/i18n/site-content';
import { Check, Copy } from 'lucide-react';
import { type ComponentProps, useRef, useState } from 'react';
import { announce } from '@/components/site/reader-content-controls';

/** A code block with a one-click copy button (Mintlify-style). When the fence
 *  carries a `title="…"` (lifted onto the child `<code>` by remarkCodeMeta), a
 *  filename header bar is drawn; otherwise the language shows as a floating badge. */
// `node` is react-markdown's hast node; it must not reach the DOM.
export function Pre({ locale, node: _node, ...props }: ComponentProps<'pre'> & { locale?: string; node?: unknown }) {
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
      lang={locale}
      className={cn(
        // [direction:ltr] keeps `end-2` physical-right even inside an RTL page,
        // matching the force-LTR code content (else it collides with the badge).
        'reader-code-copy reader-control grid size-7 cursor-pointer place-items-center rounded-md text-white/50 transition-colors [direction:ltr] hover:bg-white/10 hover:text-white/90',
        // Always visible (P3-PUB-023): white/50 on the code panel is about 5:1,
        // and hover brightens it.
        title ? '' : 'absolute end-2 top-2 z-10',
      )}
    >
      {copied ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
    </button>
  );
  return (
    // data-not-typeset: this block owns its own chrome (header bar, copy
    // button) — typeset must not restyle the <pre> inside. The dark panel, the
    // <pre> and the language badge are styled in content-blocks.css, shared with
    // the editor's code blocks. The wrapper's flow margin tracks the configured
    // rhythm.
    <div className="group mt-(--typeset-flow)" data-theme-component="code" data-not-typeset>
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
          {lang ? <span className="content-code-language">{lang}</span> : null}
          {copyButton}
        </>
      )}
      {/* Announced through the shared live region; the visible hint helps sighted readers copy by hand. */}
      {failed ? (
        <p className="reader-code-copy-failed px-4 py-2 text-sm text-white" lang={locale}>
          {t('copyFailed')}
        </p>
      ) : null}
      <pre dir="ltr" ref={ref} className={title ? undefined : 'reader-code-untitled'} {...props} />
    </div>
  );
}
