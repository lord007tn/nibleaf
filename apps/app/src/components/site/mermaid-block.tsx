import { useTheme } from '@/components/theme-provider';
import { useEffect, useId, useState } from 'react';

/**
 * Renders a ```mermaid diagram as SVG on the client. Mermaid needs the DOM, so
 * it is lazy-imported in an effect (never during SSR); until it resolves, the
 * raw source is shown as a code block. Strict security level sanitizes output.
 */
export function MermaidBlock({ children }: { children?: React.ReactNode }) {
  const chart = typeof children === 'string' ? children : Array.isArray(children) ? children.join('') : String(children ?? '');
  const rawId = useId().replace(/[^a-zA-Z0-9]/g, '');
  const { resolvedTheme } = useTheme();
  const [svg, setSvg] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: resolvedTheme === 'dark' ? 'dark' : 'default' });
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
  }, [chart, rawId, resolvedTheme]);

  if (failed || !svg) {
    return <pre className="my-5 overflow-x-auto rounded-xl border border-border bg-[#0d1117] p-4 text-sm text-white/80 [direction:ltr]">{chart}</pre>;
  }
  return (
    // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid renders + sanitizes its own SVG (securityLevel: strict).
    <div className="my-5 flex justify-center overflow-x-auto rounded-xl border border-border bg-card p-4" dangerouslySetInnerHTML={{ __html: svg }} />
  );
}
