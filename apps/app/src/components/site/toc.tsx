import { cn } from '@nibleaf/design-system/lib/utils';
import { AlignLeft } from 'lucide-react';
import { useEffect, useState } from 'react';

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
    <div className="sticky top-[calc(var(--site-header-h,4rem)+3rem)] max-h-[calc(100vh-var(--site-header-h,4rem)-4rem)] overflow-y-auto">
      <div className="mb-3 flex items-center gap-2 font-semibold text-foreground text-sm">
        <AlignLeft className="size-3.5 text-muted-foreground rtl:-scale-x-100" aria-hidden />
        {label}
      </div>
      <ul className="space-y-0.5 text-sm">
        {items.map((heading) => {
          const active = activeId === heading.id;
          return (
            <li key={heading.id}>
              <a
                className={cn(
                  'block py-1 leading-snug transition-colors',
                  active ? 'font-medium text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
                style={{ paddingInlineStart: (heading.depth - 1) * 12 }}
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
