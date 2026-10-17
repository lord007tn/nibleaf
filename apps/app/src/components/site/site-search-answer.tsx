import ReactMarkdown from 'react-markdown';

/** Loaded only for an answer; model-authored links, images and HTML stay inert. */
export default function SiteSearchAnswer({ children }: { children: string }) {
  return (
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
      {children}
    </ReactMarkdown>
  );
}
