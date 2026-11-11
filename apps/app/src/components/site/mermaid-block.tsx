import { useTheme } from '@nibleaf/design-system/theme';
import { useEffect, useId, useRef, useState } from 'react';

/**
 * Renders a ```mermaid diagram as SVG on the client. Mermaid needs the DOM, so
 * it is lazy-imported in an effect (never during SSR); until it resolves, the
 * raw source is shown as a code block. Strict security level sanitizes output.
 * Mermaid (about 160 KiB gzip) loads only once the diagram comes within a
 * screen of the viewport, so a diagram further down the page doesn't compete
 * with the article's first paint.
 */
const NEAR_VIEWPORT: IntersectionObserverInit = { rootMargin: '100% 0px' };

export function MermaidBlock({ children }: { children?: React.ReactNode }) {
  const chart = typeof children === 'string' ? children : Array.isArray(children) ? children.join('') : String(children ?? '');
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState('');
  const [failed, setFailed] = useState(false);
  const source = useRef<HTMLPreElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const node = source.current;
    if (near || !node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setNear(true);
    }, NEAR_VIEWPORT);
    observer.observe(node);
    return () => observer.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near) return;
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          layout: 'dagre',
          look: 'classic',
          theme: resolvedTheme === 'dark' ? 'dark' : 'default',
        });
        const { svg: rendered } = await mermaid.render(`mermaid-${rawId}`, chart.trim());
        if (!cancelled) {
          setSvg(rendered);
          setFailed(false);
        }
      } catch {
        if (!cancelled) {
          setFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, rawId, resolvedTheme, near]);

  if (failed || !svg) {
    return (
      <pre ref={source} className="my-5 overflow-x-auto rounded-xl border border-border bg-[#0d1117] p-4 text-sm text-white/80 [direction:ltr]">
        {chart}
      </pre>
    );
  }
  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid renders + sanitizes its own SVG (securityLevel: strict).
    <div className="my-5 flex justify-center overflow-x-auto rounded-xl border border-border bg-card p-4" dangerouslySetInnerHTML={{ __html: svg }} />
  );
}
