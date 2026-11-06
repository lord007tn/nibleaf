import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { Link } from '@tanstack/react-router';
import { Bot, FileText, Gauge, LayoutDashboard, type LucideIcon, Search, ThumbsUp } from 'lucide-react';
import { filterSearch, type InsightsSearch } from './filters';

type SectionTo =
  | '/app/projects/$projectId/analytics'
  | '/app/projects/$projectId/analytics/pages'
  | '/app/projects/$projectId/analytics/search'
  | '/app/projects/$projectId/analytics/feedback'
  | '/app/projects/$projectId/analytics/ai'
  | '/app/projects/$projectId/analytics/performance';

const SECTIONS: ReadonlyArray<{ to: SectionTo; label: MessageKey; icon: LucideIcon; exact?: boolean }> = [
  { to: '/app/projects/$projectId/analytics', label: 'analytics.tab.overview', icon: LayoutDashboard, exact: true },
  { to: '/app/projects/$projectId/analytics/pages', label: 'analytics.tab.pages', icon: FileText },
  { to: '/app/projects/$projectId/analytics/search', label: 'analytics.tab.search', icon: Search },
  { to: '/app/projects/$projectId/analytics/feedback', label: 'analytics.tab.feedback', icon: ThumbsUp },
  { to: '/app/projects/$projectId/analytics/ai', label: 'analytics.tab.ai', icon: Bot },
  { to: '/app/projects/$projectId/analytics/performance', label: 'analytics.tab.performance', icon: Gauge },
];

/**
 * The analytics sections as real links (each section has its own URL), styled
 * like the design-system line tabs. Scrolls horizontally on narrow screens and
 * carries the current filters to every section.
 */
export function InsightsSectionNav({ projectId, filters }: { projectId: string; filters: InsightsSearch }) {
  const t = useT();
  const search = filterSearch(filters);
  return (
    <nav aria-label={t('analytics.tab.label')} className="-mx-1 overflow-x-auto border-border border-b">
      <ul className="flex min-w-max items-center gap-1 px-1">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          return (
            <li key={section.to}>
              <Link
                activeOptions={{ exact: section.exact ?? false, includeSearch: false }}
                activeProps={{ 'aria-current': 'page', className: 'text-foreground after:opacity-100' }}
                className={cn(
                  'relative flex items-center gap-1.5 whitespace-nowrap px-3 py-2.5 font-medium text-muted-foreground text-sm transition-colors hover:text-foreground',
                  'after:absolute after:inset-x-2 after:bottom-[-1px] after:h-0.5 after:rounded-full after:bg-foreground after:opacity-0 after:transition-opacity',
                  'rounded-t-md focus-visible:outline-2 focus-visible:outline-ring',
                )}
                params={{ projectId }}
                search={search}
                to={section.to}
              >
                <Icon aria-hidden className="size-4" />
                {t(section.label)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
