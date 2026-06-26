import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

type TocHeading = { id: string; text: string; depth: number };

/**
 * "On this page" table of contents with scroll-spy: the heading currently in
 * view is highlighted as the reader scrolls (Mintlify parity).
 */
export function TableOfContents({ headings, label }: { headings: TocHeading[]; label: string }) {
  const items = headings.filter((heading) => heading.depth <= 3);
  const key = items.map((heading) => heading.id).join('|');
  const [activeId, setActiveId] = useState('');

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the stable signature of `items`.
  useEffect(() => {
    if (typeof window === 'undefined' || items.length === 0) {
      return;
    }
    const elements = items.map((heading) => document.getElementById(heading.id)).filter((el): el is HTMLElement => Boolean(el));
    if (elements.length === 0) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          setActiveId(visible[0].target.id);
        }
      },
      // Trigger when a heading reaches the top third of the viewport.
      { rootMargin: '0px 0px -70% 0px', threshold: 0 },
    );
    for (const element of elements) {
      observer.observe(element);
    }
    return () => observer.disconnect();
  }, [key]);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="sticky top-20">
      <div className="mb-2 font-medium text-muted-foreground text-xs uppercase tracking-wide">{label}</div>
      <ul className="space-y-1.5 border-border border-s ps-3 text-sm">
        {items.map((heading) => {
          const active = activeId === heading.id;
          return (
            <li key={heading.id} style={{ paddingInlineStart: (heading.depth - 1) * 8 }}>
              <a
                className={cn('block transition-colors', active ? 'font-medium text-primary' : 'text-muted-foreground hover:text-foreground')}
                href={`#${heading.id}`}
                aria-current={active ? 'location' : undefined}
              >
                {heading.text}
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
