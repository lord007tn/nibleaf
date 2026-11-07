import { cn } from '@nibleaf/design-system/lib/utils';
import { Star } from 'lucide-react';
import { GITHUB_URL } from '@/lib/links';
import { outlineButton } from './primitives';

export function GitHubStarLink({
  stars,
  className,
  compact = false,
  label = 'Star on GitHub',
  starsLabel,
}: {
  stars: number;
  className?: string;
  compact?: boolean;
  label?: string;
  starsLabel?: (count: number) => string;
}) {
  const count = Number.isFinite(stars) ? Math.max(0, Math.floor(stars)) : 0;
  const exact = starsLabel?.(count) ?? `${count.toLocaleString('en-US')} ${count === 1 ? 'star' : 'stars'}`;
  const display = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(count).toLowerCase();
  return (
    <a href={GITHUB_URL} className={cn(outlineButton, compact && 'px-2', className)} rel="noreferrer" target="_blank">
      <svg aria-hidden="true" className="size-4 shrink-0" fill="currentColor" viewBox="0 0 24 24">
        <path d="M12 .7a11.5 11.5 0 0 0-3.64 22.4c.58.1.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.17.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.39.96.1-.75.4-1.26.74-1.55-2.57-.29-5.27-1.28-5.27-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.04 0 0 .97-.31 3.16 1.18a10.95 10.95 0 0 1 5.76 0c2.19-1.49 3.15-1.18 3.15-1.18.63 1.58.23 2.75.12 3.04.74.81 1.18 1.83 1.18 3.09 0 4.41-2.71 5.38-5.29 5.67.42.36.79 1.06.79 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .7Z" />
      </svg>
      <span>{label}</span>
      {count > 0 && (
        <span className="inline-flex items-center gap-1 border-border border-s ps-2 text-muted-foreground tabular-nums" data-github-stars={count}>
          <Star aria-hidden="true" className="size-3" />
          {display}
        </span>
      )}
      {/* The accessible name keeps the visible text in order and adds the exact count. */}
      {count > 0 && <span className="sr-only"> ({exact})</span>}
    </a>
  );
}
