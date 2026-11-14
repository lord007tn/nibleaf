import { Button } from '@nibleaf/design-system/components/ui/button';
import { siteChatT } from '@nibleaf/i18n/site-chat';
import type { AiChatConsent, AiChatFinalEvent, AiChatSource } from '@nibleaf/validators';
import { Check, Copy, LifeBuoy } from 'lucide-react';
import { Children, cloneElement, isValidElement, type ReactNode, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { siteHref } from '@/lib/site-paths';
import { isLeftToRightLabel, leftToRightIslands, splitLastWord, textContent } from './answer-inline';
import { htmlCopy, plainCopy, writeCopy } from './copy';
import { Feedback } from './feedback';
import { answerText, citationParts } from './helpers';
import type { ChatOptions } from './provider';
import { answerSources } from './sources';

/** Where a turn was answered: its sources and their section anchors belong to it. */
export interface TurnScope {
  lang?: string;
  version?: string;
}
/** Article link, opening the cited section when the source names one, in the
 * language and version the turn was answered in (the reader may have switched since). */
const sourceHref = (
  options: Pick<ChatOptions, 'projectId' | 'lang' | 'version' | 'defaultLanguage' | 'languages'>,
  source: Pick<AiChatSource, 'path' | 'anchor' | 'language'>,
  scope: TurnScope,
) =>
  `${siteHref(options.projectId, source.path, { lang: source.language ?? scope.lang ?? options.lang, version: scope.version, defaultLanguage: options.defaultLanguage, languages: options.languages })}${source.anchor ? `#${encodeURIComponent(source.anchor)}` : ''}`;

export function ChatMessage({
  text,
  final,
  options,
  busy,
  consent,
  close,
  followUps = [],
  onFollowUp,
  onSourceOpen,
  onCopy,
  scope,
}: {
  text: string;
  final?: AiChatFinalEvent;
  /** The turn's language and version, for its links (defaults to the answer's language). */
  scope?: TurnScope;
  options: ChatOptions;
  busy: boolean;
  consent: AiChatConsent;
  close: () => void;
  /** Suggested next questions; shown for the latest answer only. */
  followUps?: string[];
  onFollowUp?: (question: string, position: number) => void;
  onSourceOpen?: (source: AiChatSource, position: number) => void;
  onCopy?: () => void;
}) {
  const t = siteChatT(final?.language ?? options.lang);
  const prefix = final?.turnId ?? 'draft';
  // A captured scope keeps its version even when that is the default one
  // (undefined); only a turn without one links in the version on screen.
  const href = (source: AiChatSource) => sourceHref(options, source, { lang: final?.language, version: options.version, ...scope });
  // Sections are numbered in the order the answer first cites them, so the
  // markers and the list read 1, 2, 3 whatever ids the model used; two citations
  // of one section share its number, and each page's title is listed once.
  const cited = answerSources(final?.status === 'no_answer' ? [] : (final?.citations ?? []));
  const sourceId = (number: number) => `${prefix}-source-${number}`;
  const answer = useRef<HTMLDivElement>(null);
  // What the last copy did, shown beside the rating buttons in a polite live
  // region that stays mounted, so screen readers announce each change (the
  // published reader mounts no toast region). `at` restarts the timer on a repeat.
  const [copied, setCopied] = useState<{ result: 'copied' | 'failed'; at: number }>();
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(undefined), copied.result === 'copied' ? 2500 : 6000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const chip = (number: number, key: string) => (
    <button
      type="button"
      data-citation={number}
      className="mx-0.5 inline-flex rounded border px-1.5 text-primary text-xs focus-visible:ring-2"
      key={key}
      aria-label={`${t('aiSource')} ${number}`}
      onClick={() => {
        const item = document.getElementById(sourceId(number));
        item?.scrollIntoView({ block: 'nearest' });
        item?.focus();
      }}
    >
      {number}
    </button>
  );
  /** A block's children with citation chips drawn, links, paths and dotted names
   * laid out as left-to-right islands, and each run of chips kept on the line of
   * the word (or bold or code run) before it, so a number never starts a line alone. */
  const cite = (children: ReactNode): ReactNode => {
    let count = 0;
    const nextKey = (name: string) => {
      count += 1;
      return `${name}-${count}`;
    };
    const items: ReactNode[] = [];
    for (const child of Children.toArray(children)) {
      if (typeof child === 'string') {
        for (const part of citationParts(child)) {
          if (!part.source) {
            for (const segment of leftToRightIslands(part.text))
              items.push(
                segment.leftToRight ? (
                  <bdi dir="ltr" key={nextKey('ltr')}>
                    {segment.text}
                  </bdi>
                ) : (
                  segment.text
                ),
              );
            continue;
          }
          const number = cited.numberOf(part.source);
          // A marker the checked answer does not list is not drawn.
          if (number !== undefined) items.push(chip(number, nextKey('chip')));
        }
      } else if (isValidElement<{ children?: ReactNode; node?: { tagName?: string } }>(child))
        // Code is shown exactly as written: a `[S1]` in it is text, not a citation.
        items.push(child.props.node?.tagName === 'code' ? child : cloneElement(child, {}, cite(child.props.children)));
      else items.push(child);
    }
    const isChip = (item: ReactNode) => isValidElement<{ 'data-citation'?: number }>(item) && item.props['data-citation'] !== undefined;
    const output: ReactNode[] = [];
    for (let index = 0; index < items.length; index += 1) {
      if (!isChip(items[index])) {
        output.push(items[index]);
        continue;
      }
      // A run of chips, with only spaces between them.
      const chips: ReactNode[] = [];
      while (
        index < items.length &&
        (isChip(items[index]) || (typeof items[index] === 'string' && !String(items[index]).trim() && isChip(items[index + 1])))
      ) {
        if (isChip(items[index])) chips.push(items[index]);
        index += 1;
      }
      index -= 1;
      // What the chips follow: the last word of the text before them, or the
      // element (bold, code, a link island) right before them.
      let before = output.pop();
      if (typeof before === 'string' && !before.trim() && output.length && typeof output.at(-1) !== 'string') before = output.pop();
      let anchor: ReactNode = before;
      if (typeof before === 'string') {
        const { head, word } = splitLastWord(before);
        if (head) output.push(head);
        anchor = word;
      }
      // Only the break between the anchor and its chips is held: a long anchor (a
      // long link, a bold label) still wraps inside, so it never overflows a narrow
      // panel, and the chips stay with its last line.
      output.push(
        <span className="whitespace-nowrap" key={nextKey('cite')}>
          {anchor === '' || anchor === undefined ? null : <span className="whitespace-normal">{anchor}</span>}
          {chips}
        </span>,
      );
    }
    return output;
  };
  /** Bold or italic text that is an English label inside any answer reads left to right on its own. */
  const label =
    (Tag: 'strong' | 'em') =>
    ({ children }: { children?: ReactNode }) => {
      // Decided from all of its text, code and nested emphasis included.
      return <Tag dir={isLeftToRightLabel(textContent(children)) ? 'ltr' : undefined}>{children}</Tag>;
    };
  const supportUrl = final?.status === 'no_answer' ? final.supportUrl : undefined;
  const external = supportUrl ? /^https?:/i.test(supportUrl) : false;
  return (
    <div aria-busy={busy} className="space-y-3 rounded-xl border p-4">
      {final?.status === 'no_answer' ? (
        // Answers come in the QUESTION's language, which can differ from the site's
        // (an Arabic question on an English site), so each lays itself out by its content.
        <p dir="auto">{final.answer}</p>
      ) : (
        <div
          ref={answer}
          dir="auto"
          // A small gap between blocks, so the answer's paragraphs and steps read as written.
          className="min-w-0 break-words text-sm leading-7 [&>*+*]:mt-2 [&_li]:ms-5 [&_ol]:list-decimal [&_ul]:list-disc"
        >
          <ReactMarkdown
            allowedElements={['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'br']}
            skipHtml
            unwrapDisallowed
            components={{
              p: ({ children }) => <p dir="auto">{cite(children)}</p>,
              // Answer headings stay compact labels inside the chat bubble.
              ...Object.fromEntries(
                (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const).map((tag) => [
                  tag,
                  ({ children }: { children?: ReactNode }) => <p className="mt-3 font-semibold first:mt-0">{cite(children)}</p>,
                ]),
              ),
              li: ({ children }) => <li>{cite(children)}</li>,
              strong: label('strong'),
              em: label('em'),
              pre: ({ children }) => (
                <pre dir="ltr" className="overflow-x-auto rounded bg-muted p-3 text-start text-xs">
                  {children}
                </pre>
              ),
              code: ({ children }) => <code dir="ltr">{children}</code>,
            }}
          >
            {answerText(text, final)}
          </ReactMarkdown>
        </div>
      )}
      {cited.groups.length > 0 && (
        <div className="space-y-2">
          <p className="font-medium text-xs">{t('aiSources')}</p>
          <ul className="space-y-2">
            {cited.groups.map((group) => (
              // A page's title is shown once, with the sections the answer cites from it.
              <li key={group.key} dir={group.direction} className="rounded-lg border p-3 text-start">
                <p className="font-medium text-sm">{group.title}</p>
                <ul className="mt-1 space-y-1">
                  {group.sections.map(({ number, source }) => (
                    <li key={number}>
                      <a
                        id={sourceId(number)}
                        href={href(source)}
                        className="-mx-1.5 flex gap-2 rounded-md px-1.5 py-1 hover:bg-primary/5 focus-visible:ring-2"
                        onClick={() => {
                          onSourceOpen?.(source, number);
                          if (window.matchMedia('(max-width: 767px)').matches) close();
                        }}
                      >
                        <span className="mt-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded border px-1 text-primary text-xs">
                          {number}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-primary text-sm">{source.heading ?? t('aiSourceTop')}</span>
                          <span className="line-clamp-2 block text-muted-foreground text-xs">{source.snippet}</span>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      )}
      {supportUrl && (
        <a
          href={supportUrl}
          {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 font-medium text-primary text-sm hover:bg-primary/5 focus-visible:ring-2"
        >
          <LifeBuoy aria-hidden className="size-4" />
          {t('aiSupport')}
        </a>
      )}
      {final?.status === 'answered' && (
        <Feedback
          final={final}
          projectId={options.projectId}
          lang={options.lang}
          consent={consent}
          leading={
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('aiCopy')}
              title={t('aiCopy')}
              onClick={async () => {
                const link = (source: AiChatSource) => new URL(href(source), window.location.origin).href;
                const labels = { sources: t('aiSources'), top: t('aiSourceTop') };
                try {
                  await writeCopy(
                    plainCopy(final.answer, cited.sections, cited.numberOf, link, labels),
                    answer.current ? htmlCopy(answer.current, cited.sections, link, labels) : undefined,
                  );
                  onCopy?.();
                  setCopied({ result: 'copied', at: Date.now() });
                } catch {
                  setCopied({ result: 'failed', at: Date.now() });
                }
              }}
            >
              {copied?.result === 'copied' ? <Check aria-hidden className="size-4 text-primary" /> : <Copy aria-hidden className="size-4" />}
            </Button>
          }
          trailing={
            <span
              aria-live="polite"
              aria-atomic="true"
              className={copied?.result === 'failed' ? 'ms-1 text-destructive text-xs' : 'ms-1 text-muted-foreground text-xs'}
            >
              {copied ? t(copied.result === 'copied' ? 'aiCopied' : 'aiCopyFailed') : ''}
            </span>
          }
        />
      )}
      {followUps.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <p className="font-medium text-xs">{t('aiFollowUps')}</p>
          <div className="flex flex-col gap-2">
            {followUps.map((question, index) => (
              <Button
                key={question}
                size="sm"
                variant="outline"
                dir="auto"
                className="h-auto justify-start whitespace-normal py-2 text-start"
                onClick={() => onFollowUp?.(question, index + 1)}
              >
                {question}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
