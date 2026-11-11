import { Button } from '@nibleaf/design-system/components/ui/button';
import { siteChatT } from '@nibleaf/i18n/site-chat';
import type { AiChatConsent, AiChatFinalEvent, AiChatSource } from '@nibleaf/validators';
import { Copy, LifeBuoy } from 'lucide-react';
import { Children, cloneElement, isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { toast } from 'sonner';
import { siteHref } from '@/lib/site-paths';
import { Feedback } from './feedback';
import { answerText, citationParts } from './helpers';
import type { ChatOptions } from './provider';

/** Where a turn was answered: its sources and their section anchors belong to it. */
export interface TurnScope {
  lang?: string;
  version?: string;
}
/** Article link, opening the cited section when the source names one, in the
 * language and version the turn was answered in (the reader may have switched since). */
const sourceHref = (
  options: Pick<ChatOptions, 'projectId' | 'lang' | 'version'>,
  source: Pick<AiChatSource, 'path' | 'anchor' | 'language'>,
  scope: TurnScope,
) =>
  `${siteHref(options.projectId, source.path, { lang: source.language ?? scope.lang ?? options.lang, version: scope.version })}${source.anchor ? `#${encodeURIComponent(source.anchor)}` : ''}`;

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
  const sources = final?.status === 'no_answer' ? [] : (final?.citations ?? []);
  // Sources are numbered in the order they are listed, so the answer's markers
  // and the cards read 1, 2, 3 whatever ids the model cited.
  const sourceNumber = (id: string) => {
    const index = sources.findIndex((source) => source.id === id);
    return index >= 0 ? String(index + 1) : id.replace(/^[SP]/, '');
  };
  const cite = (children: ReactNode): ReactNode =>
    Children.map(children, (child) => {
      if (typeof child === 'string')
        return citationParts(child).map((part) =>
          part.source && final?.citations.some((source) => source.id === part.source) ? (
            <button
              type="button"
              className="mx-0.5 inline-flex rounded border px-1.5 text-primary text-xs focus-visible:ring-2"
              key={part.key}
              aria-label={`${t('aiSource')} ${sourceNumber(part.source)}`}
              onClick={() => {
                const card = document.getElementById(`${prefix}-${part.source}`);
                card?.scrollIntoView({ block: 'nearest' });
                card?.focus();
              }}
            >
              {sourceNumber(part.source)}
            </button>
          ) : (
            part.text
          ),
        );
      if (isValidElement<{ children?: ReactNode }>(child)) return cloneElement(child, {}, cite(child.props.children));
      return child;
    });
  const supportUrl = final?.status === 'no_answer' ? final.supportUrl : undefined;
  const external = supportUrl ? /^https?:/i.test(supportUrl) : false;
  return (
    <div aria-busy={busy} className="space-y-3 rounded-xl border p-4">
      {final?.status === 'no_answer' ? (
        <p>{final.answer}</p>
      ) : (
        <div className="min-w-0 break-words text-sm leading-7 [&_li]:ms-5 [&_ul]:list-disc [&_ol]:list-decimal">
          <ReactMarkdown
            allowedElements={['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'br']}
            skipHtml
            unwrapDisallowed
            components={{
              p: ({ children }) => <p>{cite(children)}</p>,
              // Answer headings stay compact labels inside the chat bubble.
              ...Object.fromEntries(
                (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const).map((tag) => [
                  tag,
                  ({ children }: { children?: ReactNode }) => <p className="mt-3 font-semibold first:mt-0">{cite(children)}</p>,
                ]),
              ),
              li: ({ children }) => <li>{cite(children)}</li>,
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
      {sources.length > 0 && (
        <div className="space-y-2">
          {final?.status === 'no_answer' ? null : <p className="font-medium text-xs">{t('aiSources')}</p>}
          {sources.map((source, index) => (
            <a
              key={source.id}
              id={`${prefix}-${source.id}`}
              dir={source.direction}
              href={href(source)}
              className="block rounded-lg border p-3 text-start focus-visible:ring-2"
              onClick={() => {
                onSourceOpen?.(source, index + 1);
                if (window.matchMedia('(max-width: 767px)').matches) close();
              }}
            >
              <span className="font-medium">
                {index + 1}. {source.title}
              </span>
              {source.heading && (
                <span className="text-muted-foreground">
                  {' › '}
                  {source.heading}
                </span>
              )}
              <span className="mt-1 line-clamp-2 block text-muted-foreground text-xs">{source.snippet}</span>
            </a>
          ))}
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
                try {
                  await navigator.clipboard.writeText(
                    `${final.answer}\n\n${t('aiSources')}\n${final.citations.map((source) => `${source.title}: ${new URL(href(source), window.location.origin).href}`).join('\n')}`,
                  );
                  onCopy?.();
                  toast.success(t('aiCopied'));
                } catch {
                  toast.error(t('aiCopyFailed'));
                }
              }}
            >
              <Copy aria-hidden className="size-4" />
            </Button>
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
