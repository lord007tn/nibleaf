import { Button } from '@nibleaf/design-system/components/ui/button';
import { cn } from '@nibleaf/design-system/lib/utils';
import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { filterSearch, type InsightsSearch } from './filters';

type SectionPath = 'pages' | 'search' | 'feedback' | 'ai' | 'performance';

/** "See all" style link to another analytics section, keeping the filters. */
export function SectionLink({
  projectId,
  filters,
  section,
  children,
}: {
  projectId: string;
  filters: InsightsSearch;
  section: SectionPath;
  children: ReactNode;
}) {
  return (
    <Button
      className="-me-2"
      nativeButton={false}
      render={<Link params={{ projectId }} search={filterSearch(filters)} to={`/app/projects/$projectId/analytics/${section}`} />}
      size="sm"
      variant="ghost"
    >
      {children}
      <ChevronRight aria-hidden className="size-4 rtl:-scale-x-100" />
    </Button>
  );
}

/** Link to one page's drill-down (`/analytics/pages?path=…`), keeping the filters. */
export function PageInsightsLink({
  projectId,
  filters,
  path,
  children,
  className,
}: {
  projectId: string;
  filters: InsightsSearch;
  path: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      className={cn('min-w-0 rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring', className)}
      params={{ projectId }}
      search={{ ...filterSearch(filters), path }}
      to="/app/projects/$projectId/analytics/pages"
    >
      {children}
    </Link>
  );
}
