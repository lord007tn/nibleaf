import { Button } from '@nibleaf/design-system/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@nibleaf/design-system/components/ui/collapsible';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import type { MessageKey } from '@nibleaf/i18n';
import { useLocale } from '@nibleaf/i18n/react';
import { jwtAccessConfigBody } from '@nibleaf/validators';
import { ChevronDown } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  friendlyErrorMessage,
  type ReaderAccessData,
  useCreateReaderAudience,
  useDeleteReaderAudience,
  useEmergencyRevokeReaderAccess,
  usePages,
  useTestReaderJwt,
  useUpdateReaderJwt,
} from '@/hooks/api';
import { countVariables, localeTag } from '@/lib/format';
import { DirtyStateReporter } from '../shared';

/** Audit actions emitted by apps/server/src/actions/reader-access.ts and site-sign-in.ts; unknown values fall back to the raw action. */
const AUDIT_ACTION_KEYS: Record<string, MessageKey> = {
  ACCESS_MODE_CHANGED: 'settings.authentication.reader.audit.action.accessModeChanged',
  AUDIENCE_CREATED: 'settings.authentication.reader.audit.action.audienceCreated',
  AUDIENCE_UPDATED: 'settings.authentication.reader.audit.action.audienceUpdated',
  AUDIENCE_DELETED: 'settings.authentication.reader.audit.action.audienceDeleted',
  READER_INVITED: 'settings.authentication.reader.audit.action.readerInvited',
  READER_UPDATED: 'settings.authentication.reader.audit.action.readerUpdated',
  READER_REVOKED: 'settings.authentication.reader.audit.action.readerRevoked',
  EMERGENCY_REVOKE: 'settings.authentication.reader.audit.action.emergencyRevoke',
  JWT_CONFIGURATION_UPDATED: 'settings.authentication.reader.audit.action.jwtConfigurationUpdated',
  INVITATION_ACTIVATED: 'settings.authentication.reader.audit.action.invitationActivated',
  JWT_REJECTED: 'settings.authentication.reader.audit.action.jwtRejected',
  JWT_SESSION_CREATED: 'settings.authentication.reader.audit.action.jwtSessionCreated',
  READER_SIGNED_IN: 'settings.visibility.audit.readerSignedIn',
  MEMBER_SIGNED_IN: 'settings.visibility.audit.memberSignedIn',
  READER_ADDED_BY_DOMAIN: 'settings.visibility.audit.readerAddedByDomain',
  EMAIL_DOMAINS_UPDATED: 'settings.visibility.audit.emailDomainsUpdated',
};

const Panel = ({ title, description, children }: { title: string; description: string; children: ReactNode }) => (
  <section className="rounded-lg border border-border p-4">
    <h4 className="font-semibold text-sm">{title}</h4>
    <p className="mt-1 mb-4 text-muted-foreground text-xs">{description}</p>
    {children}
  </section>
);

/**
 * Controls most owners never need: page-limited audiences, the JWT handoff from
 * a customer portal, and the access log with emergency revocation. Folded away
 * under "Advanced access" so the everyday choices stay simple.
 */
export function AdvancedAccess({ projectId, data, disabled }: { projectId: string; data: ReaderAccessData; disabled: boolean }) {
  const { locale, t } = useLocale();
  const confirm = useConfirm();
  const { data: pages = [] } = usePages(projectId);
  const createAudience = useCreateReaderAudience(projectId);
  const deleteAudience = useDeleteReaderAudience(projectId);
  const updateJwt = useUpdateReaderJwt(projectId);
  const testJwt = useTestReaderJwt(projectId);
  const emergencyRevoke = useEmergencyRevokeReaderAccess(projectId);
  const [audienceName, setAudienceName] = useState('');
  const [audiencePages, setAudiencePages] = useState<string[]>([]);
  const [jwtEnabled, setJwtEnabled] = useState(false);
  const [issuer, setIssuer] = useState('');
  const [jwtAudience, setJwtAudience] = useState('');
  const [jwksUrl, setJwksUrl] = useState('');
  const [publicJwks, setPublicJwks] = useState('');
  const [groupsClaim, setGroupsClaim] = useState('groups');
  const [claimMapping, setClaimMapping] = useState('{}');
  const [testToken, setTestToken] = useState('');
  useEffect(() => {
    if (!data.jwt) return;
    setJwtEnabled(data.jwt.enabled);
    setIssuer(data.jwt.issuer);
    setJwtAudience(data.jwt.audience);
    setJwksUrl(data.jwt.jwksUrl ?? '');
    setPublicJwks(data.jwt.publicJwks ? JSON.stringify(data.jwt.publicJwks, null, 2) : '');
    setGroupsClaim(data.jwt.groupsClaim);
    setClaimMapping(JSON.stringify(data.jwt.claimMapping ?? {}, null, 2));
  }, [data]);
  const pageOptions = useMemo(
    () =>
      pages
        .filter((page) => page.kind === 'PAGE')
        .map((page) => ({
          value: page.id,
          label: (
            <>
              <span dir="auto">{page.title}</span> · <span dir="ltr">/{page.path}</span>
            </>
          ),
        })),
    [pages],
  );
  const labelFor = (value: string) => {
    const key = AUDIT_ACTION_KEYS[value];
    return key ? t(key) : value;
  };
  const fail = (error: unknown) => toast.error(friendlyErrorMessage(t, error, 'settings.saveError'));

  const addAudience = async () => {
    await createAudience.mutateAsync({ name: audienceName, pageIds: audiencePages });
    setAudienceName('');
    setAudiencePages([]);
    toast.success(t('settings.authentication.reader.audienceCreated'));
  };
  const removeAudience = async (audience: { id: string; name: string }) => {
    const ok = await confirm({ title: t('settings.authentication.reader.deleteAudienceConfirm', { name: audience.name }), destructive: true });
    if (ok) await deleteAudience.mutateAsync(audience.id);
  };
  const emergency = async () => {
    const ok = await confirm({
      title: t('settings.authentication.reader.emergencyAction'),
      description: t('settings.authentication.reader.emergencyConfirm'),
      confirmLabel: t('settings.authentication.reader.emergencyAction'),
      destructive: true,
    });
    if (!ok) return;
    await emergencyRevoke.mutateAsync(undefined);
    toast.success(t('settings.authentication.reader.emergencySuccess'));
  };
  const saveJwt = async () => {
    let mapping: Record<string, string>;
    let keys: unknown;
    try {
      mapping = JSON.parse(claimMapping) as Record<string, string>;
      keys = publicJwks.trim() ? JSON.parse(publicJwks) : null;
    } catch {
      toast.error(t('settings.authentication.reader.jsonError'));
      return;
    }
    await updateJwt.mutateAsync(
      jwtAccessConfigBody.parse({
        enabled: jwtEnabled,
        issuer,
        audience: jwtAudience,
        ...(jwksUrl.trim() ? { jwksUrl: jwksUrl.trim(), publicJwks: null } : { jwksUrl: null, publicJwks: keys }),
        subjectClaim: 'sub',
        emailClaim: 'email',
        nameClaim: 'name',
        groupsClaim,
        claimMapping: mapping,
        sessionTtlMinutes: 480,
        maxTokenAgeSeconds: 300,
        clockToleranceSecs: 30,
      }),
    );
    toast.success(t('settings.authentication.reader.jwtSaved'));
  };

  return (
    <Collapsible className="mt-8 rounded-xl border border-border">
      <DirtyStateReporter
        dirty={
          Boolean(audienceName || testToken) ||
          audiencePages.length > 0 ||
          jwtEnabled !== (data.jwt?.enabled ?? false) ||
          issuer !== (data.jwt?.issuer ?? '') ||
          jwtAudience !== (data.jwt?.audience ?? '') ||
          jwksUrl !== (data.jwt?.jwksUrl ?? '') ||
          publicJwks !== (data.jwt?.publicJwks ? JSON.stringify(data.jwt.publicJwks, null, 2) : '') ||
          groupsClaim !== (data.jwt?.groupsClaim ?? 'groups') ||
          claimMapping !== (data.jwt ? JSON.stringify(data.jwt.claimMapping ?? {}, null, 2) : '{}')
        }
      />
      <CollapsibleTrigger className="group flex w-full items-center justify-between gap-3 px-4 py-3 text-start">
        <span>
          <span className="block font-semibold text-sm">{t('settings.visibility.advanced.title')}</span>
          <span className="mt-0.5 block text-muted-foreground text-xs">{t('settings.visibility.advanced.body')}</span>
        </span>
        <ChevronDown aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-data-[panel-open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-4 border-border border-t p-4">
        <Panel title={t('settings.authentication.reader.audiencesTitle')} description={t('settings.authentication.reader.audiencesDescription')}>
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              aria-label={t('settings.authentication.reader.audiencesTitle')}
              disabled={disabled}
              onChange={(event) => setAudienceName(event.target.value)}
              placeholder={t('settings.authentication.reader.audiencePlaceholder')}
              value={audienceName}
            />
            <Select items={pageOptions} multiple onValueChange={(next) => setAudiencePages(next ?? [])} value={audiencePages}>
              <SelectTrigger aria-label={t('settings.authentication.reader.audiencesTitle')} className="w-full" disabled={disabled}>
                <SelectValue placeholder={t('settings.authentication.reader.audienceAllPages')} />
              </SelectTrigger>
              <SelectContent>
                {pageOptions.map((page) => (
                  <SelectItem key={page.value} value={page.value}>
                    {page.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            className="mt-3"
            disabled={disabled || !audienceName.trim()}
            loading={createAudience.isPending}
            onClick={() => void addAudience().catch(fail)}
            type="button"
          >
            {t('settings.authentication.reader.createAudience')}
          </Button>
          {data.audiences.length > 0 ? (
            <ul className="mt-4 divide-y rounded-md border">
              {data.audiences.map((audience) => (
                <li className="flex items-center justify-between gap-3 p-3 text-sm" key={audience.id}>
                  <div className="min-w-0">
                    <div className="truncate font-medium" dir="auto">
                      {audience.name}
                    </div>
                    <div className="text-muted-foreground text-xs">
                      {audience.grants.some((grant) => !grant.pageId)
                        ? t('settings.authentication.reader.entireSite')
                        : t('settings.authentication.reader.pageCount', countVariables(locale, audience.grants.length))}{' '}
                      · {t('settings.authentication.reader.readerCount', { count: audience._count.readers })}
                    </div>
                  </div>
                  <Button
                    disabled={disabled}
                    loading={deleteAudience.isPending && deleteAudience.variables === audience.id}
                    onClick={() => void removeAudience(audience).catch(fail)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {t('common.delete')}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>

        <Panel title={t('settings.authentication.reader.jwtTitle')} description={t('settings.authentication.reader.jwtDescription')}>
          <div className="mb-3 flex items-center gap-2 text-sm">
            <Switch checked={jwtEnabled} disabled={disabled} id="reader-jwt-enabled" onCheckedChange={setJwtEnabled} />
            <Label htmlFor="reader-jwt-enabled">{t('settings.authentication.reader.jwtEnable')}</Label>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <Input dir="ltr" onChange={(event) => setIssuer(event.target.value)} placeholder="https://portal.example.com" value={issuer} />
            <Input dir="ltr" onChange={(event) => setJwtAudience(event.target.value)} placeholder="nibleaf-docs" value={jwtAudience} />
            <Input
              dir="ltr"
              onChange={(event) => setJwksUrl(event.target.value)}
              placeholder="https://portal.example.com/.well-known/jwks.json"
              value={jwksUrl}
            />
            <Input dir="ltr" onChange={(event) => setGroupsClaim(event.target.value)} placeholder="groups" value={groupsClaim} />
          </div>
          <Textarea
            className="mt-3 font-mono text-xs"
            dir="ltr"
            onChange={(event) => setPublicJwks(event.target.value)}
            placeholder={t('settings.authentication.reader.jwksPlaceholder')}
            value={publicJwks}
          />
          <Textarea
            className="mt-3 font-mono text-xs"
            dir="ltr"
            onChange={(event) => setClaimMapping(event.target.value)}
            placeholder={'{"customer":"audience_id"}'}
            value={claimMapping}
          />
          <Button className="mt-3" disabled={disabled} loading={updateJwt.isPending} onClick={() => void saveJwt().catch(fail)} type="button">
            {t('settings.authentication.reader.jwtSave')}
          </Button>
          <div className="mt-5 border-t pt-4">
            <Textarea
              aria-label={t('settings.authentication.reader.jwtTest')}
              className="font-mono text-xs"
              dir="ltr"
              onChange={(event) => setTestToken(event.target.value)}
              placeholder={t('settings.authentication.reader.jwtTestPlaceholder')}
              value={testToken}
            />
            <Button
              className="mt-2"
              disabled={!testToken}
              loading={testJwt.isPending}
              onClick={() =>
                void testJwt
                  .mutateAsync(testToken)
                  .then((result) => toast.success(`${t('settings.authentication.reader.jwtValid')}: ${JSON.stringify(result)}`))
                  .catch(fail)
              }
              type="button"
              variant="outline"
            >
              {t('settings.authentication.reader.jwtTest')}
            </Button>
          </div>
        </Panel>

        <Panel title={t('settings.authentication.reader.auditTitle')} description={t('settings.authentication.reader.auditDescription')}>
          <Button
            disabled={disabled}
            loading={emergencyRevoke.isPending}
            onClick={() => void emergency().catch(fail)}
            type="button"
            variant="destructive"
          >
            {t('settings.authentication.reader.emergencyAction')}
          </Button>
          {data.audit.length > 0 ? (
            <ul className="mt-4 max-h-56 divide-y overflow-auto rounded-md border">
              {data.audit.map((event) => (
                <li className="flex justify-between gap-3 p-2 text-xs" key={event.id}>
                  <span>{labelFor(event.action)}</span>
                  <time className="text-muted-foreground" dateTime={event.createdAt}>
                    {new Date(event.createdAt).toLocaleString(localeTag(locale))}
                  </time>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
      </CollapsibleContent>
    </Collapsible>
  );
}
