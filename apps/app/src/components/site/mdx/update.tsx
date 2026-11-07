import { siteContentT } from '@nibleaf/i18n/site-content';
import type { ReactNode } from 'react';

// ─── Update (changelog entry) ─────────────────────────────────────────────────

export function Update({
  label,
  description,
  tags = [],
  language,
  children,
}: {
  label?: string;
  description?: string;
  tags?: readonly string[];
  language?: string;
  children?: ReactNode;
}) {
  const t = siteContentT(language);
  return (
    <div className="my-6 border-border border-s ps-6">
      {label || tags.length > 0 ? (
        <div className="-ms-[calc(1.5rem+0.5px)] mb-2 flex flex-wrap items-center gap-2">
          {label ? <span className="inline-block rounded-full border border-border bg-card px-3 py-0.5 font-medium text-xs">{label}</span> : null}
          {tags.length > 0 ? (
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={t('tags')}>
              {tags.map((tag) => (
                <li key={tag} dir="auto" className="m-0 rounded-md bg-muted px-2 py-0.5 font-medium text-muted-foreground text-xs">
                  {tag}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {description ? <div className="mb-2 text-muted-foreground text-sm">{description}</div> : null}
      <div className="[&>:first-child]:mt-0 [&>:last-child]:mb-0">{children}</div>
    </div>
  );
}
