import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { DataList, DataListItem, DataListSkeleton } from '@nibleaf/design-system/components/ui/data-list';
import { EmptyState } from '@nibleaf/design-system/components/ui/empty-state';
import { ScrollArea } from '@nibleaf/design-system/components/ui/scroll-area';
import { StatusBadge } from '@nibleaf/design-system/components/ui/status-badge';
import type { MessageKey } from '@nibleaf/i18n';
import { useT } from '@nibleaf/i18n/react';
import { Link } from '@tanstack/react-router';
import { CircleCheck, PenLine } from 'lucide-react';
import { useId, useMemo } from 'react';
import type { PublishCheck } from '@/hooks/api/types';
import { useFormatters } from '@/lib/format';

type CheckCode = PublishCheck['code'];

/** Group order: what breaks the live site first, cosmetic issues last. */
const CHECK_META: Record<CheckCode, { title: MessageKey; hint: MessageKey; order: number }> = {
  'broken-internal-link': { title: 'publish.checks.brokenLink', hint: 'publish.checks.brokenLinkHint', order: 0 },
  'empty-page': { title: 'publish.checks.emptyPage', hint: 'publish.checks.emptyPageHint', order: 1 },
  'untitled-page': { title: 'publish.checks.untitledPage', hint: 'publish.checks.untitledPageHint', order: 2 },
  'missing-alt': { title: 'publish.checks.missingAlt', hint: 'publish.checks.missingAltHint', order: 3 },
  'duplicate-title': { title: 'publish.checks.duplicateTitle', hint: 'publish.checks.duplicateTitleHint', order: 4 },
  'stray-characters': { title: 'publish.checks.strayCharacters', hint: 'publish.checks.strayCharactersHint', order: 5 },
  'unreadable-slug': { title: 'publish.checks.unreadableSlug', hint: 'publish.checks.unreadableSlugHint', order: 6 },
};

/** One row per page and check: a page with three broken links is one thing to fix. */
interface CheckRow {
  pageId: string;
  title: string;
  path: string;
  languageCode: string;
  details: string[];
  /** Details that are links too long to serve. */
  tooLong: string[];
}

interface CheckGroup {
  code: CheckCode;
  severity: PublishCheck['severity'];
  rows: CheckRow[];
}

const groupChecks = (checks: readonly PublishCheck[]): CheckGroup[] => {
  const groups = new Map<string, CheckGroup>();
  for (const check of checks) {
    const key = `${check.severity}:${check.code}`;
    const group = groups.get(key) ?? { code: check.code, severity: check.severity, rows: [] };
    groups.set(key, group);
    const row = group.rows.find((candidate) => candidate.pageId === check.pageId);
    if (row) {
      if (check.detail && !row.details.includes(check.detail)) row.details.push(check.detail);
      if (check.reason === 'path-too-long' && !row.tooLong.includes(check.detail)) row.tooLong.push(check.detail);
    } else {
      group.rows.push({
        pageId: check.pageId,
        title: check.title,
        path: check.path,
        languageCode: check.languageCode,
        details: check.detail ? [check.detail] : [],
        tooLong: check.reason === 'path-too-long' ? [check.detail] : [],
      });
    }
  }
  return [...groups.values()].sort(
    (a, b) => (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1) || CHECK_META[a.code].order - CHECK_META[b.code].order,
  );
};

interface PublishChecksProps {
  projectId: string;
  checks: readonly PublishCheck[];
  loading: boolean;
  /** Closes the publish dialog when a Fix link opens the editor. */
  onFix: () => void;
}

/**
 * The "Checks" part of the publish dialog: a one-line verdict, then the
 * problems grouped by kind with a Fix link to each page. Warnings never block;
 * errors (the publish would fail) do, and the dialog disables Publish for them.
 */
export function PublishChecks({ projectId, checks, loading, onFix }: PublishChecksProps) {
  const t = useT();
  const { count } = useFormatters();
  const headingId = useId();
  const groups = useMemo(() => groupChecks(checks), [checks]);
  const errors = checks.filter((check) => check.severity === 'error').length;
  const warnings = checks.length - errors;
  const multiLang = new Set(checks.map((check) => check.languageCode)).size > 1;

  const summary = errors
    ? [
        t('publish.checks.errorCount', count(errors)),
        warnings ? t('publish.checks.warningCount', count(warnings)) : null,
        t('publish.checks.mustFix'),
      ]
    : [t('publish.checks.warningCount', count(warnings)), t('publish.checks.stillAllowed')];

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2" data-testid="publish-checks">
      <h3 className="font-medium text-sm" id={headingId}>
        {t('publish.checks.title')}
      </h3>
      {loading ? (
        <DataListSkeleton bordered loadingLabel={t('publish.checking')} rows={2} withLeading={false} />
      ) : checks.length === 0 ? (
        <EmptyState
          className="rounded-xl border border-border py-6"
          description={t('publish.checks.allClearHint')}
          headingLevel={4}
          icon={<CircleCheck />}
          title={t('publish.checks.allClear')}
        />
      ) : (
        <>
          <Callout className="py-2.5" title={summary.filter(Boolean).join(' · ')} tone={errors ? 'danger' : 'warning'} />
          <ScrollArea className="max-h-72 rounded-xl border border-border">
            <div className="divide-y divide-border">
              {groups.map((group) => {
                const meta = CHECK_META[group.code];
                const groupHeadingId = `${headingId}-${group.severity}-${group.code}`;
                return (
                  <div key={`${group.severity}-${group.code}`}>
                    <div className="flex flex-col gap-1 px-4 pt-3 sm:px-5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="font-medium text-sm" id={groupHeadingId}>
                          {t(meta.title)}
                        </h4>
                        <StatusBadge size="sm" tone={group.severity === 'error' ? 'danger' : 'warning'}>
                          {t(group.severity === 'error' ? 'publish.checks.error' : 'publish.checks.warning')}
                        </StatusBadge>
                      </div>
                      <p className="text-muted-foreground text-xs">{t(meta.hint)}</p>
                    </div>
                    <DataList aria-labelledby={groupHeadingId}>
                      {group.rows.map((row) => {
                        const title = row.title.trim() || t('editor.untitled');
                        return (
                          <DataListItem
                            badges={
                              multiLang && row.languageCode ? (
                                <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground uppercase">
                                  {row.languageCode}
                                </span>
                              ) : null
                            }
                            description={<CheckDetails code={group.code} details={row.details} tooLong={row.tooLong} />}
                            key={row.pageId}
                            meta={
                              <span className="break-all font-mono" dir="ltr">
                                /{row.path}
                              </span>
                            }
                            title={<bdi>{title}</bdi>}
                            trailing={
                              <Button
                                aria-label={t('publish.checks.fixLabel', { title })}
                                className="min-h-9"
                                nativeButton={false}
                                onClick={onFix}
                                render={<Link params={{ projectId }} search={{ page: row.pageId }} to="/app/projects/$projectId/editor" />}
                                size="sm"
                                variant="outline"
                              >
                                <PenLine aria-hidden />
                                {t('publish.checks.fix')}
                              </Button>
                            }
                          />
                        );
                      })}
                    </DataList>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </>
      )}
    </section>
  );
}

/** The evidence under a row: the broken links, image sources or stray text,
 *  read left to right as code; or, for a duplicate, the other page. */
function CheckDetails({ code, details, tooLong = [] }: { code: CheckCode; details: string[]; tooLong?: string[] }) {
  const t = useT();
  if (details.length === 0 || code === 'unreadable-slug') return null;
  if (code === 'duplicate-title') {
    return <span>{t('publish.checks.duplicateOf', { path: `/${details[0] ?? ''}` })}</span>;
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {details.map((detail) => (
        <span className="inline-flex flex-wrap items-center gap-1" key={detail}>
          <code className="break-all rounded bg-muted px-1 py-0.5 text-[11.5px] text-foreground" dir="ltr">
            {detail}
          </code>
          {tooLong.includes(detail) ? <span className="text-muted-foreground">{t('publish.checks.pathTooLong')}</span> : null}
        </span>
      ))}
    </span>
  );
}
