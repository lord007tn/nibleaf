import { cn } from '@nibleaf/design-system/lib/utils';
import { blockDirection } from '@nibleaf/shared/script-direction';
import { AlignLeft } from 'lucide-react';
import { type CSSProperties, useEffect, useState } from 'react';

type TocHeading = { id: string; text: string; depth: number };

/** Select from all headings, including headings unchanged by observer callbacks. */
export function selectActiveHeading(headings: { id: string; top: number }[], threshold: number, atEnd: boolean): string {
  if (atEnd) return headings.at(-1)?.id ?? '';
  let active = headings[0]?.id ?? '';
  for (const heading of headings) {
    if (heading.top > threshold) break;
    active = heading.id;
  }
  return active;
}

type LanguageAttributes = { lang?: string; dir?: 'ltr' | 'rtl' };

/** `labelLanguage`: the reader's `lang`/`dir` for the label (the summary and
 *  the outline's name), and `itemsLanguage` the article's for its headings, when
 *  the two differ, as on a fallback page. */
export function MobileTableOfContents({
  headings,
  label,
  labelLanguage,
  itemsLanguage,
}: {
  headings: TocHeading[];
  label: string;
  labelLanguage?: LanguageAttributes;
  itemsLanguage?: LanguageAttributes;
}) {
  if (!headings.some((heading) => heading.depth <= 3)) return null;
  return (
    <details className="mb-6 rounded-lg border border-border xl:hidden" data-theme-region="mobile-toc">
      <summary className="min-h-11 cursor-pointer px-4 py-3 font-medium text-sm" {...labelLanguage}>
        {label}
      </summary>
      <div className="max-h-[50dvh] overflow-y-auto px-4 pb-3">
        <TableOfContents headings={headings} label={label} mobile labelLanguage={labelLanguage} itemsLanguage={itemsLanguage} />
      </div>
    </details>
  );
}

/** `itemsLanguage`: the article's `lang`/`dir` for the headings listed, when it
 *  differs from the reader's; `labelLanguage`: the reader's for the outline's own
 *  name, where it sits inside the article (the mobile outline). */
export function TableOfContents({
  headings,
  label,
  mobile = false,
  labelLanguage,
  itemsLanguage,
}: {
  headings: TocHeading[];
  label: string;
  mobile?: boolean;
  labelLanguage?: LanguageAttributes;
  itemsLanguage?: LanguageAttributes;
}) {
  const items = headings.filter((heading) => heading.depth <= 3);
  const key = items.map((heading) => heading.id).join('|');
  const [activeId, setActiveId] = useState('');

  // biome-ignore lint/correctness/useExhaustiveDependencies: key is the stable signature of items.
  useEffect(() => {
    if (mobile || items.length === 0) return;
    let positions: { id: string; top: number }[] = [];
    let frame = 0;
    const update = () => {
      frame = 0;
      const scrollTop = window.scrollY;
      const atEnd = scrollTop > 0 && scrollTop + window.innerHeight >= document.documentElement.scrollHeight - 2;
      setActiveId(selectActiveHeading(positions, scrollTop + window.innerHeight * 0.25, atEnd));
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    const measure = () => {
      // Cache document offsets on layout changes; scrolling performs no heading measurements.
      positions = items.flatMap(({ id }) => {
        const element = document.getElementById(id);
        return element ? [{ id, top: element.getBoundingClientRect().top + window.scrollY }] : [];
      });
      schedule();
    };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(document.body);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [key, mobile]);

  if (items.length === 0) return null;

  return (
    <nav
      aria-label={label}
      {...labelLanguage}
      data-theme-component="toc"
      className={cn(
        !mobile && 'sticky top-[calc(var(--site-header-h,4rem)+3rem)] max-h-[calc(100vh-var(--site-header-h,4rem)-4rem)] overflow-y-auto',
      )}
    >
      {!mobile ? (
        <div className="mb-3 flex items-center gap-2 font-semibold text-foreground text-sm" data-theme-region="toc-label">
          <AlignLeft className="size-3.5 text-muted-foreground rtl:-scale-x-100" aria-hidden />
          {label}
        </div>
      ) : null}
      <ul className="space-y-0.5 text-sm" data-theme-region="toc-list" {...itemsLanguage}>
        {items.map((heading) => {
          const active = activeId === heading.id;
          return (
            <li key={heading.id}>
              <a
                className={cn(
                  'block py-1 leading-snug transition-colors',
                  mobile && 'min-h-11 py-3',
                  active ? 'font-medium text-primary' : 'text-muted-foreground hover:text-foreground',
                )}
                style={{ '--toc-depth': heading.depth - 1 } as CSSProperties}
                data-theme-region="toc-link"
                data-active={active ? '' : undefined}
                href={`#${heading.id}`}
                aria-current={active ? 'location' : undefined}
                onClick={(event) => {
                  setActiveId(heading.id);
                  // Close the phone outline before the anchor scroll, so the heading lands
                  // where expected; the browser then starts keyboard focus from it.
                  const details = mobile ? event.currentTarget.closest('details') : null;
                  if (details) details.open = false;
                }}
              >
                {/* Isolated in its own direction; the outline keeps the page's alignment. */}
                <span dir={blockDirection(heading.text)}>{heading.text}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
