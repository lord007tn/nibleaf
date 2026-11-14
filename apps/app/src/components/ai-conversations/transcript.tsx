import { Children, cloneElement, isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import { citationParts } from '@/components/site/ai-chat/helpers';
import { siteHref } from '@/lib/site-paths';

interface TranscriptSource {
  id: string;
  title: string;
  path: string;
  heading?: string;
  anchor?: string;
}

// Saved conversations lack the frozen snapshot's collision policy. The legacy
// query lets the reader choose its current canonical prefix without guessing.
export const transcriptSourceHref = (projectId: string, source: TranscriptSource, language: string, version?: string) =>
  `${siteHref(projectId, source.path, { version })}?lang=${encodeURIComponent(language)}${source.anchor ? `#${encodeURIComponent(source.anchor)}` : ''}`;

/** Render only saved citations, never model-provided links or HTML. */
export function TranscriptAnswer({
  answer,
  citations,
  projectId,
  language,
  version,
}: {
  answer: string;
  citations: TranscriptSource[];
  projectId: string;
  language: string;
  version?: string;
}) {
  const cite = (children: ReactNode): ReactNode =>
    Children.map(children, (child) => {
      if (typeof child === 'string')
        return citationParts(child).map((part) => {
          const index = citations.findIndex((source) => source.id === part.source);
          const source = citations[index];
          return part.source && source ? (
            <a
              key={part.key}
              className="mx-0.5 rounded border px-1.5 text-primary text-xs"
              href={transcriptSourceHref(projectId, source, language, version)}
              target="_blank"
              rel="noreferrer"
              title={[source.title, source.heading].filter(Boolean).join(' — ')}
            >
              {index + 1}
            </a>
          ) : (
            part.text
          );
        });
      return isValidElement<{ children?: ReactNode }>(child) ? cloneElement(child, {}, cite(child.props.children)) : child;
    });
  return (
    <ReactMarkdown
      skipHtml
      unwrapDisallowed
      allowedElements={['p', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'br']}
      components={{ p: ({ children }) => <p>{cite(children)}</p>, li: ({ children }) => <li>{cite(children)}</li> }}
    >
      {answer}
    </ReactMarkdown>
  );
}
