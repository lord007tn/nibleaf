import { siteT } from '@nibleaf/i18n/site';
import ReactMarkdown from 'react-markdown';
import type { SearchAnswer } from '@/hooks/api/types';
import { siteHref } from '@/lib/site-paths';

/** Loaded only for an answer; model-authored links, images and HTML stay inert. */
export default function SiteSearchAnswer({
  answer,
  projectId,
  lang,
  version,
  rtl,
}: {
  answer: SearchAnswer;
  projectId: string;
  lang?: string;
  version?: string;
  rtl: boolean;
}) {
  const t = siteT(lang);
  return (
    <div className="space-y-4">
      <div className="min-w-0 space-y-3 text-sm leading-7 [&_li]:ms-5 [&_ol]:list-decimal [&_ul]:list-disc" dir={rtl ? 'rtl' : 'ltr'}>
        <ReactMarkdown
          allowedElements={['p', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'br']}
          skipHtml
          unwrapDisallowed
          components={{
            pre: ({ children }) => (
              <pre className="max-w-full overflow-x-auto rounded-md bg-muted p-3 text-start text-xs" dir="ltr">
                {children}
              </pre>
            ),
            code: ({ children }) => <code dir="ltr">{children}</code>,
          }}
        >
          {answer.answer}
        </ReactMarkdown>
      </div>
      {answer.citations.length > 0 ? (
        <div className="space-y-2 border-t pt-3">
          <p className="font-medium text-xs uppercase tracking-wide text-muted-foreground">{t('sources')}</p>
          {answer.citations.map((citation) => (
            <a
              key={citation.id}
              className="block rounded-md border p-3 text-start transition-colors hover:bg-muted/60"
              href={siteHref(projectId, citation.path, { lang, version })}
              dir={citation.direction}
            >
              <span className="font-medium text-sm">
                [{citation.id}] {citation.title}
              </span>
              {citation.heading ? <span className="ms-2 text-muted-foreground text-xs">· {citation.heading}</span> : null}
              <span className="mt-1 line-clamp-2 block text-muted-foreground text-xs">{citation.snippet}</span>
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
