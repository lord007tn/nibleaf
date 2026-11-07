import { Link as LinkIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { hasIcon, PageIcon } from '@/components/site/page-icon';

// ─── Related content ────────────────────────────────────────────────────────

export function RelatedContent({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <section className="my-8" data-theme-component="related-content">
      {title ? <h2 className="mb-3 text-lg">{title}</h2> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function RelatedCard({
  title,
  description,
  href,
  icon,
  children,
}: {
  title?: string;
  description?: string;
  href?: string;
  icon?: string;
  children?: ReactNode;
}) {
  const body = (
    <>
      <span className="mt-0.5 text-primary" aria-hidden>
        {icon && hasIcon(icon) ? <PageIcon name={icon} className="size-4" /> : <LinkIcon className="size-4" />}
      </span>
      <span className="min-w-0">
        {title ? <span className="block font-semibold text-foreground">{title}</span> : null}
        {description ? <span className="mt-1 block text-muted-foreground text-sm">{description}</span> : null}
        {children ? <span className="mt-1 block text-muted-foreground text-sm [&>:first-child]:mt-0 [&>:last-child]:mb-0">{children}</span> : null}
      </span>
    </>
  );
  const className = 'flex gap-3 rounded-xl border border-border bg-card p-4 no-underline transition-colors hover:border-primary/50';
  return href ? (
    <a href={href} className={className} data-theme-component="related-card">
      {body}
    </a>
  ) : (
    <div className={className} data-theme-component="related-card">
      {body}
    </div>
  );
}
