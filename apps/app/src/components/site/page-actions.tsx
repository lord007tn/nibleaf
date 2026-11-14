import { cn } from '@nibleaf/design-system/lib/utils';
import { sitePageActionsT } from '@nibleaf/i18n/site-page-actions';
import { markdownAliasPath } from '@nibleaf/shared/markdown-discovery';
import { Check, ChevronDown, Copy } from 'lucide-react';
import { type ComponentProps, useEffect, useRef, useState } from 'react';
import type { ContentLanguageAttributes } from '@/components/site/content-language';
import { headerMenusModule } from '@/components/site/header-menus-module';
import { announce } from '@/components/site/reader-content-controls';
import { useIntentModule } from '@/lib/intent-module';
import { IntentTrigger } from './intent-trigger';

/*
 * Page actions for people and AI tools (PUB-018), a split button beside the
 * page title: "Copy page" copies the page's Markdown twin (every page has one,
 * `/guide.md`), and the menu offers it as plain Markdown or opens it in ChatGPT
 * or Claude. The menu rides the header menus' chunk, loaded when a reader
 * reaches for it, so published pages carry only these two buttons.
 */

/** The page's Markdown twin, for a reader href that may carry `?lang=`/`?version=`. */
export function pageMarkdownHref(pageHref: string): string {
  const [path = '/', query] = pageHref.split('?');
  return `${markdownAliasPath(path)}${query ? `?${query}` : ''}`;
}

const askPrompt = (markdownUrl: string) => `Read ${markdownUrl} so I can ask questions about it.`;
/** Where "Open in …" goes, with the page's absolute Markdown URL in the prompt. */
export const askAiLinks = (markdownUrl: string) => ({
  chatgpt: `https://chatgpt.com/?hints=search&q=${encodeURIComponent(askPrompt(markdownUrl))}`,
  claude: `https://claude.ai/new?q=${encodeURIComponent(askPrompt(markdownUrl))}`,
});

/** The shared look of the two halves; the menu's own trigger uses it too. */
const pageActionButtonClass =
  'inline-flex h-8 cursor-pointer items-center gap-1.5 border border-border bg-background px-2.5 font-medium text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground focus-visible:relative focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2 pointer-coarse:h-11 pointer-coarse:px-3';

/** The menu half's markup, shared by the static trigger and the menu's own. */
export function pageActionsTriggerProps(lang?: string): ComponentProps<'button'> {
  return {
    type: 'button',
    'aria-label': sitePageActionsT(lang)('pageActions'),
    // 44px wide as well as tall on touch screens (pointer-coarse:h-11 above).
    className: cn(pageActionButtonClass, '-ms-px rounded-e-md px-2 pointer-coarse:min-w-11 pointer-coarse:justify-center'),
    children: <ChevronDown className="size-3.5" aria-hidden />,
  };
}

export function PageActions({
  pageHref,
  lang,
  attributes,
  className,
}: {
  pageHref: string;
  lang?: string;
  /** The reader's language and direction, for a fallback page whose article is in another language. */
  attributes?: ContentLanguageAttributes;
  className?: string;
}) {
  const t = sitePageActionsT(lang);
  const markdownHref = pageMarkdownHref(pageHref);
  const [copied, setCopied] = useState(false);
  const { loaded, start, trigger, failed } = useIntentModule(headerMenusModule);
  // The newest copy wins. A slower request for a page the reader has since left,
  // or from an earlier click, is aborted, and even if its response still arrives
  // it can never write over a newer copy.
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const copy = async () => {
    pending.current?.abort();
    const request = new AbortController();
    pending.current = request;
    try {
      const response = await fetch(markdownHref, { headers: { accept: 'text/markdown' }, signal: request.signal });
      if (!response.ok) throw new Error(String(response.status));
      const markdown = await response.text();
      if (pending.current !== request) return;
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      announce(t('pageCopied'));
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // A superseded request ends quietly; only the current one reports a failure.
      if (request.signal.aborted || pending.current !== request) return;
      announce(t('pageCopyFailed'));
    }
  };
  return (
    <div className={cn('inline-flex shrink-0 print:hidden', className)} data-page-actions="" {...attributes}>
      <button type="button" onClick={copy} className={cn(pageActionButtonClass, 'rounded-s-md')} title={t('copyPageHint')}>
        {copied ? <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        <span>{t('copyPage')}</span>
      </button>
      {loaded ? (
        <loaded.PageActionsMenu lang={lang} markdownHref={markdownHref} onCopy={copy} start={start} />
      ) : (
        <IntentTrigger failed={failed} lang={lang}>
          <button {...pageActionsTriggerProps(lang)} data-slot="dropdown-menu-trigger" aria-haspopup="menu" aria-expanded={false} {...trigger} />
        </IntentTrigger>
      )}
    </div>
  );
}
