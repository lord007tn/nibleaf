import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { DataList, DataListItem, DataListSkeleton } from '@nibleaf/design-system/components/ui/data-list';
import { EmptyState } from '@nibleaf/design-system/components/ui/empty-state';
import { StatusBadge } from '@nibleaf/design-system/components/ui/status-badge';
import { cn } from '@nibleaf/design-system/lib/utils';
import type { MessageKey } from '@nibleaf/i18n';
import { useLocale, useT } from '@nibleaf/i18n/react';
import { isLocatablePublishCheck, publishFixSearch } from '@nibleaf/shared/publish-check-codes';
import { Link } from '@tanstack/react-router';
import { ChevronDown, CircleCheck, PenLine } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import type { PublishCheck } from '@/hooks/api/types';
import { useFormatters } from '@/lib/format';
import { languageName } from '@/lib/language-name';

type CheckCode = PublishCheck['code'];

/** Group order: what breaks the live site first, cosmetic issues last. */
const CHECK_META: Record<CheckCode, { title: MessageKey; hint: MessageKey; order: number }> = {
  'broken-internal-link': { title: 'publish.checks.brokenLink', hint: 'publish.checks.brokenLinkHint', order: 0 },
  'empty-page': { title: 'publish.checks.emptyPage', hint: 'publish.checks.emptyPageHint', order: 1 },
  'untitled-page': { title: 'publish.checks.untitledPage', hint: 'publish.checks.untitledPageHint', order: 2 },
  'video-not-https': { title: 'publish.checks.videoNotHttps', hint: 'publish.checks.videoNotHttpsHint', order: 3 },
  'missing-alt': { title: 'publish.checks.missingAlt', hint: 'publish.checks.missingAltHint', order: 4 },
  'embed-untitled': { title: 'publish.checks.embedUntitled', hint: 'publish.checks.embedUntitledHint', order: 5 },
  'embed-as-link': { title: 'publish.checks.embedAsLink', hint: 'publish.checks.embedAsLinkHint', order: 6 },
  'embed-unclosed': { title: 'publish.checks.embedUnclosed', hint: 'publish.checks.embedUnclosedHint', order: 7 },
  'video-poster-hidden': { title: 'publish.checks.videoPosterHidden', hint: 'publish.checks.videoPosterHiddenHint', order: 8 },
  'duplicate-title': { title: 'publish.checks.duplicateTitle', hint: 'publish.checks.duplicateTitleHint', order: 9 },
  'stray-characters': { title: 'publish.checks.strayCharacters', hint: 'publish.checks.strayCharactersHint', order: 10 },
  'unreadable-slug': { title: 'publish.checks.unreadableSlug', hint: 'publish.checks.unreadableSlugHint', order: 11 },
  'home-untranslated': { title: 'publish.checks.homeUntranslated', hint: 'publish.checks.homeUntranslatedHint', order: 12 },
  'blog-root-group': { title: 'publish.checks.blogRootGroup', hint: 'publish.checks.blogRootGroupHint', order: 13 },
};

/** One row per thing to fix: a page-level problem is one row for its page; a
 *  problem on the page (a broken link, an image) is one row per item, so each
 *  has its own Fix that opens the editor at it. */
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
    const locatable = isLocatablePublishCheck(check.code);
    const row = group.rows.find((candidate) => candidate.pageId === check.pageId && (!locatable || candidate.details[0] === check.detail));
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
 * The "Checks" part of the publish sheet: a one-line verdict, then the
 * problems grouped by kind with a Fix link that opens the page at the problem.
 * Warnings never block; errors (the publish would fail) do, and the sheet
 * disables Publish for them. While an error remains, warning groups start
 * collapsed to their title and count, so the blocking problems lead.
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
          <div className="divide-y divide-border rounded-xl border border-border">
            {groups.map((group) => (
              <CheckGroupSection
                defaultOpen={group.severity === 'error' || errors === 0}
                group={group}
                headingId={`${headingId}-${group.severity}-${group.code}`}
                key={`${group.severity}-${group.code}`}
                multiLang={multiLang}
                onFix={onFix}
                projectId={projectId}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** One kind of problem: its name, severity, page count and hint, then a row per
 *  page. A collapsed group still names itself and how many pages it covers. */
function CheckGroupSection({
  group,
  headingId,
  defaultOpen,
  multiLang,
  projectId,
  onFix,
}: {
  group: CheckGroup;
  headingId: string;
  defaultOpen: boolean;
  multiLang: boolean;
  projectId: string;
  onFix: () => void;
}) {
  const t = useT();
  const { count } = useFormatters();
  const [open, setOpen] = useState(defaultOpen);
  const locatable = isLocatablePublishCheck(group.code);
  const meta = CHECK_META[group.code];
  const rowsId = `${headingId}-rows`;
  return (
    <div data-check-group={group.code}>
      <div className="flex flex-col gap-1 px-4 pt-3 pb-1 sm:px-5">
        <div className="flex items-center gap-2">
          <h4 className="min-w-0 font-medium text-sm" id={headingId}>
            {t(meta.title)}
          </h4>
          <StatusBadge size="sm" tone={group.severity === 'error' ? 'danger' : 'warning'}>
            {t(group.severity === 'error' ? 'publish.checks.error' : 'publish.checks.warning')}
          </StatusBadge>
          <Button
            aria-controls={rowsId}
            aria-expanded={open}
            aria-labelledby={`${headingId}-toggle ${headingId}`}
            className="ms-auto shrink-0 text-muted-foreground"
            id={`${headingId}-toggle`}
            onClick={() => setOpen((value) => !value)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {open ? t('publish.checks.hide') : t('publish.checks.show', count(group.rows.length))}
            <ChevronDown aria-hidden className={cn('size-4 transition-transform', open && 'rotate-180')} />
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">{t(meta.hint)}</p>
      </div>
      <DataList aria-labelledby={headingId} hidden={!open} id={rowsId}>
        {group.rows.map((row) => {
          const title = row.title.trim() || t('editor.untitled');
          const evidence = row.details[0];
          // Unique per button: two problems on one page never share a name.
          const problem = locatable && evidence ? `${t(meta.title)} · ${evidence}` : t(meta.title);
          return (
            <DataListItem
              badges={
                multiLang && row.languageCode ? (
                  <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground text-xs uppercase">{row.languageCode}</span>
                ) : null
              }
              description={<CheckDetails code={group.code} details={row.details} tooLong={row.tooLong} />}
              key={`${row.pageId}:${locatable ? evidence : ''}`}
              meta={
                <span className="break-all font-mono" dir="ltr">
                  /{row.path}
                </span>
              }
              title={<bdi>{title}</bdi>}
              trailing={
                <Button
                  aria-label={t('publish.checks.fixProblem', { title, problem })}
                  className="min-h-9"
                  nativeButton={false}
                  onClick={onFix}
                  render={
                    <Link
                      params={{ projectId }}
                      search={publishFixSearch(
                        group.code,
                        row.pageId,
                        evidence ? { detail: evidence, truncated: row.tooLong.includes(evidence) } : undefined,
                      )}
                      to="/app/projects/$projectId/editor"
                    />
                  }
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
}

/** A `home-untranslated` detail: JSON from the server's check. */
const homeLanding = (detail: string): { language: string; landing: string; key: string | null; path: string } => {
  try {
    const parsed = JSON.parse(detail) as Partial<{ language: string; landing: string; key: string | null; path: string }>;
    return { language: parsed.language ?? '', landing: parsed.landing ?? '', key: parsed.key ?? null, path: parsed.path ?? '' };
  } catch {
    return { language: detail, landing: '', key: null, path: '' };
  }
};

/** The evidence under a row: the broken links, image sources or stray text,
 *  read left to right as code; or, for a duplicate, the other page. */
function CheckDetails({ code, details, tooLong = [] }: { code: CheckCode; details: string[]; tooLong?: string[] }) {
  const { locale, t } = useLocale();
  if (details.length === 0 || code === 'unreadable-slug') return null;
  if (code === 'duplicate-title') {
    return <span>{t('publish.checks.duplicateOf', { path: `/${details[0] ?? ''}` })}</span>;
  }
  if (code === 'home-untranslated') {
    // Who lands where instead of on a translation of this page, and the exact
    // change that sends them to one.
    return (
      <span className="flex flex-col gap-0.5">
        {details.map((detail) => {
          const landing = homeLanding(detail);
          const language = languageName(landing.language, undefined, locale);
          return (
            <span className="flex flex-col gap-0.5" key={detail}>
              <span>{t('publish.checks.homeUntranslatedLanding', { language, title: landing.landing })}</span>
              <span>
                {landing.key
                  ? t('publish.checks.homeUntranslatedFixKey', { language, key: landing.key })
                  : t('publish.checks.homeUntranslatedFixPath', { language, path: `/${landing.path}` })}
              </span>
            </span>
          );
        })}
      </span>
    );
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {details.map((detail) => (
        <span className="inline-flex flex-wrap items-center gap-1" key={detail}>
          <code className="break-all rounded bg-muted px-1 py-0.5 text-foreground text-xs" dir="ltr">
            {detail}
          </code>
          {tooLong.includes(detail) ? <span className="text-muted-foreground">{t('publish.checks.pathTooLong')}</span> : null}
        </span>
      ))}
    </span>
  );
}
