import { ActionDialog } from '@nibleaf/design-system/components/ui/action-dialog';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Callout } from '@nibleaf/design-system/components/ui/callout';
import { DataList, DataListEmpty, DataListItem, DataListSkeleton, RowActions, RowActionsItem } from '@nibleaf/design-system/components/ui/data-list';
import { EmptyState } from '@nibleaf/design-system/components/ui/empty-state';
import { PageHeader } from '@nibleaf/design-system/components/ui/page-header';
import { SettingsSection } from '@nibleaf/design-system/components/ui/settings-section';
import { StatusBadge, type StatusBadgeTone } from '@nibleaf/design-system/components/ui/status-badge';
import { useT } from '@nibleaf/i18n/react';
import { Eye, EyeOff, Languages, Plus, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { AddLanguageDialog } from '@/components/editor/add-language-dialog';
import type { Language, Project } from '@/hooks/api';
import { friendlyErrorMessage } from '@/hooks/api/errors';
import { useProjectAdminStatus } from '@/hooks/use-project-admin-status';
import { isolate } from '@/lib/bidi';
import { useFormatters } from '@/lib/format';
import { useLanguageActions, useSiteLanguages } from '../api/hooks';
import {
  addLanguageDecision,
  type CoverageSummary,
  coverageSummary,
  type Decision,
  isShownOnSite,
  type LanguageActionReason,
  type LanguagesAccess,
  languageDir,
  languageRowActions,
  languagesAccess,
  orderLanguages,
  type PendingLanguageWrites,
  showsWriteControls,
} from '../model/languages';

const REASON_KEY = {
  alreadyDefault: 'settings.languages.reason.alreadyDefault',
  defaultAlwaysShown: 'settings.languages.hint',
  defaultCantBeDeleted: 'settings.languages.reason.defaultCantBeDeleted',
  saving: 'common.saving',
} as const satisfies Record<LanguageActionReason, string>;

const COVERAGE_TONE = { complete: 'success', partial: 'warning', none: 'neutral' } as const satisfies Record<
  Extract<CoverageSummary, { kind: 'compared' }>['tone'],
  StatusBadgeTone
>;

type Confirmation = { kind: 'makeDefault' | 'remove'; language: Language };

/**
 * Site settings → Languages: the site's languages with their translation
 * coverage, and per row Make default, Show/Hide on site and Delete. A hidden
 * language stays editable in the dashboard but leaves every public surface of
 * the published site. Viewers see the list without write controls.
 */
export function LanguagesSettings({ project }: { project: Project }) {
  const t = useT();
  const query = useSiteLanguages(project.id);
  const actions = useLanguageActions(project.id);
  const adminStatus = useProjectAdminStatus(project.id);
  const access = languagesAccess(adminStatus.edit);
  const [addOpen, setAddOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const ask = (kind: Confirmation['kind'], language: Language) => {
    setConfirmation({ kind, language });
    setConfirmOpen(true);
  };

  const setShown = async (language: Language, shown: boolean) => {
    try {
      await actions.setShown(language.id, shown);
      toast.success(t('common.saved'));
    } catch (error) {
      toast.error(friendlyErrorMessage(t, error, 'settings.saveError'));
    }
  };

  const add = addLanguageDecision(access);
  const rows = orderLanguages(query.data ?? []);

  return (
    <div className="me-auto flex w-full max-w-[47.5rem] flex-col gap-8">
      <PageHeader
        actions={
          showsWriteControls(access) ? (
            <Button disabled={add.state !== 'allowed'} onClick={() => setAddOpen(true)} type="button" variant="outline">
              <Plus aria-hidden /> {t('settings.languages.add')}
            </Button>
          ) : null
        }
        description={t('settings.languages.description')}
        title={t('settings.languages')}
      />

      <AccessCallout access={access} onRetry={() => void adminStatus.retry()} retrying={adminStatus.retrying} />

      {query.isError ? (
        <Callout
          action={
            <Button loading={query.isFetching} onClick={() => void query.refetch()} size="sm" type="button" variant="outline">
              {t('error.tryAgain')}
            </Button>
          }
          title={t('error.title')}
          tone="danger"
          urgent
        >
          {t('error.unexpected')}
        </Callout>
      ) : null}

      {query.isError && !query.data ? null : (
        <SettingsSection footer={<p>{t('settings.languages.hint')}</p>}>
          {query.isPending ? (
            <DataListSkeleton loadingLabel={t('common.loading')} withLeading={false} />
          ) : rows.length === 0 ? (
            <DataListEmpty>
              <EmptyState icon={<Languages />} title={t('settings.languages.empty')} />
            </DataListEmpty>
          ) : (
            <DataList aria-label={t('settings.languages')}>
              {rows.map((language) => (
                <LanguageRow
                  access={access}
                  key={language.id}
                  language={language}
                  onMakeDefault={() => ask('makeDefault', language)}
                  onRemove={() => ask('remove', language)}
                  onSetShown={(shown) => void setShown(language, shown)}
                  pending={actions.pending}
                />
              ))}
            </DataList>
          )}
        </SettingsSection>
      )}

      <AddLanguageDialog onCreated={() => setAddOpen(false)} onOpenChange={setAddOpen} open={addOpen} projectId={project.id} />

      {confirmation?.kind === 'makeDefault' ? (
        <ActionDialog
          cancelLabel={t('common.cancel')}
          confirmLabel={t('settings.languages.makeDefault')}
          description={t('settings.languages.defaultConfirm.description')}
          errorMessage={(error) => friendlyErrorMessage(t, error, 'settings.saveError')}
          fallbackErrorMessage={t('settings.saveError')}
          onConfirm={async () => {
            await actions.makeDefault(confirmation.language.id);
            toast.success(t('common.saved'));
          }}
          onOpenChange={setConfirmOpen}
          open={confirmOpen}
          title={t('settings.languages.defaultConfirm.title')}
        />
      ) : confirmation?.kind === 'remove' ? (
        <ActionDialog
          cancelLabel={t('common.cancel')}
          confirmLabel={t('settings.languages.delete')}
          description={t('settings.languages.deleteConfirm.description')}
          destructive
          errorMessage={(error) => friendlyErrorMessage(t, error, 'settings.languages.deleteError')}
          fallbackErrorMessage={t('settings.languages.deleteError')}
          onConfirm={async () => {
            await actions.remove(confirmation.language.id);
            toast.success(t('settings.languages.deleted'));
          }}
          onOpenChange={setConfirmOpen}
          open={confirmOpen}
          title={t('settings.languages.deleteConfirm.title', { label: isolate(confirmation.language.label) })}
        />
      ) : null}
    </div>
  );
}

/** The one note at the top when this person can't change languages, or their access couldn't be checked. */
function AccessCallout({ access, onRetry, retrying }: { access: LanguagesAccess; onRetry: () => void; retrying: boolean }) {
  const t = useT();
  if (access === 'readOnly') return <Callout>{t('access.viewOnly.action')}</Callout>;
  if (access === 'unknown') {
    return (
      <Callout
        action={
          <Button loading={retrying} onClick={onRetry} size="sm" type="button" variant="outline">
            {t('common.retry')}
          </Button>
        }
        data-testid="access-unknown-callout"
        title={t('access.unknown.title')}
        tone="warning"
      >
        {t('access.unknown.body')}
      </Callout>
    );
  }
  return null;
}

function LanguageRow({
  language,
  access,
  pending,
  onMakeDefault,
  onSetShown,
  onRemove,
}: {
  language: Language;
  access: LanguagesAccess;
  pending: PendingLanguageWrites;
  onMakeDefault: () => void;
  onSetShown: (shown: boolean) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const { count } = useFormatters();
  const rowActions = languageRowActions(language, access, pending);
  const coverage = coverageSummary(language);
  const label = isolate(language.label);

  return (
    <DataListItem
      badges={
        <>
          {language.isDefault ? <StatusBadge tone="info">{t('settings.languages.defaultBadge')}</StatusBadge> : null}
          {isShownOnSite(language) ? null : <StatusBadge tone="warning">{t('settings.languages.hiddenBadge')}</StatusBadge>}
          {coverage?.kind === 'compared' && coverage.percentage !== null ? (
            <StatusBadge tone={COVERAGE_TONE[coverage.tone]}>
              {t('settings.languages.coverage.percent', { percent: coverage.percentage })}
            </StatusBadge>
          ) : null}
        </>
      }
      data-language-id={language.id}
      meta={
        <>
          <span className="font-mono" dir="ltr">
            {language.code}
          </span>
          <span>{language.direction === 'RTL' ? t('settings.languages.direction.rtl') : t('settings.languages.direction.ltr')}</span>
          {coverage ? <CoverageMeta coverage={coverage} /> : null}
          {coverage && coverage.missing > 0 ? <span>{t('settings.languages.coverage.missing', count(coverage.missing))}</span> : null}
          {coverage && coverage.extra > 0 ? <span>{t('settings.languages.coverage.extra', count(coverage.extra))}</span> : null}
        </>
      }
      title={
        <span dir={languageDir(language)} lang={language.code}>
          {language.label}
        </span>
      }
      trailing={
        showsWriteControls(access) ? (
          <RowActions label={t('settings.languages.actionsFor', { label })}>
            <RowActionsItem {...decisionProps(rowActions.makeDefault, t)} icon={<Star aria-hidden />} onSelect={onMakeDefault}>
              {t('settings.languages.makeDefault')}
            </RowActionsItem>
            <RowActionsItem
              {...decisionProps(rowActions.visibility, t)}
              icon={rowActions.visibility.next === 'show' ? <Eye aria-hidden /> : <EyeOff aria-hidden />}
              onSelect={() => onSetShown(rowActions.visibility.next === 'show')}
            >
              {rowActions.visibility.next === 'show' ? t('settings.languages.show') : t('settings.languages.hide')}
            </RowActionsItem>
            <RowActionsItem {...decisionProps(rowActions.remove, t)} destructive icon={<Trash2 aria-hidden />} onSelect={onRemove}>
              {t('settings.languages.delete')}
            </RowActionsItem>
          </RowActions>
        ) : null
      }
    />
  );
}

/** A decision as menu-item props: locked is disabled with no reason; disabled carries its reason. */
function decisionProps(decision: Decision, t: ReturnType<typeof useT>) {
  if (decision.state === 'locked') return { disabled: true };
  if (decision.state === 'disabled') return { disabledReason: t(REASON_KEY[decision.reason]) };
  return {};
}

function CoverageMeta({ coverage }: { coverage: CoverageSummary }) {
  const t = useT();
  const { count } = useFormatters();
  if (coverage.kind === 'source') return <span>{t('settings.languages.coverage.sourcePages', count(coverage.pageCount))}</span>;
  if (coverage.kind === 'noSource') return <span>{t('settings.languages.coverage.noSourcePages')}</span>;
  return <span>{t('settings.languages.coverage.summary', { matched: coverage.matched, total: coverage.total })}</span>;
}
