import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { useLocale } from '@nibleaf/i18n/react';
import { jwtAccessConfigBody } from '@nibleaf/validators';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  type Project,
  useCreateReaderAudience,
  useDeleteReaderAudience,
  useEmergencyRevokeReaderAccess,
  useInviteReader,
  usePages,
  useReaderAccess,
  useRevokeReader,
  useTestReaderJwt,
  useUpdateReaderAccessMode,
  useUpdateReaderJwt,
} from '@/hooks/api';
import { Field, SectionHeader, Segmented } from './shared';

type AccessMode = 'PUBLIC' | 'WORKSPACE' | 'READERS';
const Panel = ({ title, description, children }: { title: string; description: string; children: ReactNode }) => (
  <section className="mt-8 rounded-lg border border-border p-4">
    <h3 className="font-semibold text-sm">{title}</h3>
    <p className="mt-1 mb-4 text-muted-foreground text-xs">{description}</p>
    {children}
  </section>
);

export function AuthenticationSection({ project }: { project: Project }) {
  const { locale, t } = useLocale();
  const { data: pages = [] } = usePages(project.id);
  const readerAccess = useReaderAccess(project.id);
  const data = readerAccess.data;
  const updateMode = useUpdateReaderAccessMode(project.id);
  const createAudience = useCreateReaderAudience(project.id);
  const deleteAudience = useDeleteReaderAudience(project.id);
  const inviteReader = useInviteReader(project.id);
  const revokeReader = useRevokeReader(project.id);
  const updateJwt = useUpdateReaderJwt(project.id);
  const testJwt = useTestReaderJwt(project.id);
  const emergencyRevoke = useEmergencyRevokeReaderAccess(project.id);
  const [mode, setMode] = useState<AccessMode>('PUBLIC');
  const [audienceName, setAudienceName] = useState('');
  const [audiencePages, setAudiencePages] = useState<string[]>([]);
  const [readerEmail, setReaderEmail] = useState('');
  const [readerName, setReaderName] = useState('');
  const [readerAudiences, setReaderAudiences] = useState<string[]>([]);
  const [jwtEnabled, setJwtEnabled] = useState(false);
  const [issuer, setIssuer] = useState('');
  const [jwtAudience, setJwtAudience] = useState('');
  const [jwksUrl, setJwksUrl] = useState('');
  const [publicJwks, setPublicJwks] = useState('');
  const [groupsClaim, setGroupsClaim] = useState('groups');
  const [claimMapping, setClaimMapping] = useState('{}');
  const [testToken, setTestToken] = useState('');
  const [showJwt, setShowJwt] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  useEffect(() => {
    if (!data) return;
    setMode(data.accessMode);
    if (!data.jwt) return;
    setJwtEnabled(data.jwt.enabled);
    setIssuer(data.jwt.issuer);
    setJwtAudience(data.jwt.audience);
    setJwksUrl(data.jwt.jwksUrl ?? '');
    setPublicJwks(data.jwt.publicJwks ? JSON.stringify(data.jwt.publicJwks, null, 2) : '');
    setGroupsClaim(data.jwt.groupsClaim);
    setClaimMapping(JSON.stringify(data.jwt.claimMapping ?? {}, null, 2));
  }, [data]);
  const pageOptions = useMemo(() => pages.filter((page) => page.kind === 'PAGE'), [pages]);

  const saveMode = async () => {
    await updateMode.mutateAsync({ mode });
    toast.success(t('settings.authentication.reader.modeSaved'));
  };
  const addAudience = async () => {
    await createAudience.mutateAsync({ name: audienceName, pageIds: audiencePages });
    setAudienceName('');
    setAudiencePages([]);
    toast.success(t('settings.authentication.reader.audienceCreated'));
  };
  const invite = async () => {
    const result = await inviteReader.mutateAsync({
      email: readerEmail,
      ...(readerName ? { name: readerName } : {}),
      audienceIds: readerAudiences,
    });
    setReaderEmail('');
    setReaderName('');
    if (navigator.clipboard) await navigator.clipboard.writeText(result.activationUrl).catch(() => undefined);
    toast.success(t('settings.authentication.reader.invited'));
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
    <div>
      <SectionHeader description={t('settings.authentication.description')} icon="◉" title={t('settings.authentication.title')} />
      <Field hint={t('settings.authentication.reader.modeHint')} label={t('settings.authentication.reader.mode')}>
        <Segmented
          className="max-w-[540px]"
          onChange={setMode}
          options={[
            { value: 'PUBLIC', label: t('settings.authentication.mode.public') },
            { value: 'WORKSPACE', label: t('settings.authentication.reader.workspace') },
            { value: 'READERS', label: t('settings.authentication.reader.private') },
          ]}
          value={mode}
        />
        <Button
          className="mt-3"
          disabled={readerAccess.isPending}
          onClick={() => void saveMode().catch((error) => toast.error(error.message))}
          type="button"
        >
          {t('settings.authentication.reader.saveMode')}
        </Button>
      </Field>

      {data?.accessMode === 'READERS' ? (
        <>
          <Panel title={t('settings.authentication.reader.audiencesTitle')} description={t('settings.authentication.reader.audiencesDescription')}>
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                onChange={(event) => setAudienceName(event.target.value)}
                placeholder={t('settings.authentication.reader.audiencePlaceholder')}
                value={audienceName}
              />
              <select
                aria-label={t('settings.authentication.reader.audiencesTitle')}
                className="min-h-9 rounded-md border border-input bg-background px-3 text-sm"
                multiple
                onChange={(event) => setAudiencePages([...event.target.selectedOptions].map((option) => option.value))}
                value={audiencePages}
              >
                {pageOptions.map((page) => (
                  <option key={page.id} value={page.id}>
                    {page.title} · /{page.path}
                  </option>
                ))}
              </select>
            </div>
            <p className="mt-2 text-muted-foreground text-xs">{t('settings.authentication.reader.audienceAllPages')}</p>
            <Button
              className="mt-3"
              disabled={!audienceName.trim()}
              onClick={() => void addAudience().catch((error) => toast.error(error.message))}
              type="button"
            >
              {t('settings.authentication.reader.createAudience')}
            </Button>
            <div className="mt-4 divide-y rounded-md border">
              {(data?.audiences ?? []).map((audience) => (
                <div className="flex items-center justify-between gap-3 p-3 text-sm" key={audience.id}>
                  <div>
                    <div className="font-medium">{audience.name}</div>
                    <div className="text-muted-foreground text-xs">
                      {audience.grants.some((grant) => !grant.pageId)
                        ? t('settings.authentication.reader.entireSite')
                        : t('settings.authentication.reader.pageCount', { count: audience.grants.length })}{' '}
                      · {t('settings.authentication.reader.readerCount', { count: audience._count.readers })}
                    </div>
                  </div>
                  <Button
                    onClick={() =>
                      window.confirm(t('settings.authentication.reader.deleteAudienceConfirm', { name: audience.name }))
                        ? void deleteAudience.mutateAsync(audience.id).catch((error) => toast.error(error.message))
                        : undefined
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title={t('settings.authentication.reader.readersTitle')} description={t('settings.authentication.reader.readersDescription')}>
            <div className="grid gap-3 md:grid-cols-3">
              <Input onChange={(event) => setReaderEmail(event.target.value)} placeholder="reader@example.com" type="email" value={readerEmail} />
              <Input
                onChange={(event) => setReaderName(event.target.value)}
                placeholder={t('settings.authentication.reader.nameOptional')}
                value={readerName}
              />
              <select
                aria-label={t('settings.authentication.reader.readersTitle')}
                className="min-h-9 rounded-md border border-input bg-background px-3 text-sm"
                multiple
                onChange={(event) => setReaderAudiences([...event.target.selectedOptions].map((option) => option.value))}
                value={readerAudiences}
              >
                {(data?.audiences ?? []).map((audience) => (
                  <option key={audience.id} value={audience.id}>
                    {audience.name}
                  </option>
                ))}
              </select>
            </div>
            <Button
              className="mt-3"
              disabled={!readerEmail || readerAudiences.length === 0}
              onClick={() => void invite().catch((error) => toast.error(error.message))}
              type="button"
            >
              {t('settings.authentication.reader.invite')}
            </Button>
            <div className="mt-4 divide-y rounded-md border">
              {(data?.readers ?? []).map((reader) => (
                <div className="flex items-center justify-between gap-3 p-3 text-sm" key={reader.id}>
                  <div>
                    <div className="font-medium">{reader.name || reader.email || t('settings.authentication.reader.portalReader')}</div>
                    <div className="text-muted-foreground text-xs">
                      {reader.status} · {reader.audiences.map((item) => item.audience.name).join(', ')} ·{' '}
                      {t('settings.authentication.reader.sessionCount', { count: reader._count.sessions })}
                    </div>
                  </div>
                  <Button
                    disabled={reader.status === 'REVOKED'}
                    onClick={() =>
                      window.confirm(
                        t('settings.authentication.reader.revokeConfirm', {
                          name: reader.name || reader.email || t('settings.authentication.reader.thisReader'),
                        }),
                      )
                        ? void revokeReader.mutateAsync(reader.id).catch((error) => toast.error(error.message))
                        : undefined
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {t('settings.authentication.reader.revoke')}
                  </Button>
                </div>
              ))}
            </div>
          </Panel>

          <Panel title={t('settings.authentication.reader.jwtTitle')} description={t('settings.authentication.reader.jwtDescription')}>
            <Button onClick={() => setShowJwt((value) => !value)} type="button" variant="outline">
              {showJwt
                ? t('settings.authentication.reader.jwtHide')
                : jwtEnabled
                  ? t('settings.authentication.reader.jwtManage')
                  : t('settings.authentication.reader.jwtConfigure')}
            </Button>
            {showJwt ? (
              <div className="mt-4">
                <label className="mb-3 flex items-center gap-2 text-sm">
                  <input checked={jwtEnabled} onChange={(event) => setJwtEnabled(event.target.checked)} type="checkbox" />{' '}
                  {t('settings.authentication.reader.jwtEnable')}
                </label>
                <div className="grid gap-3 md:grid-cols-2">
                  <Input onChange={(event) => setIssuer(event.target.value)} placeholder="https://portal.example.com" value={issuer} />
                  <Input onChange={(event) => setJwtAudience(event.target.value)} placeholder="nibleaf-docs" value={jwtAudience} />
                  <Input
                    onChange={(event) => setJwksUrl(event.target.value)}
                    placeholder="https://portal.example.com/.well-known/jwks.json"
                    value={jwksUrl}
                  />
                  <Input onChange={(event) => setGroupsClaim(event.target.value)} placeholder="groups" value={groupsClaim} />
                </div>
                <Textarea
                  className="mt-3 font-mono text-xs"
                  onChange={(event) => setPublicJwks(event.target.value)}
                  placeholder={t('settings.authentication.reader.jwksPlaceholder')}
                  value={publicJwks}
                />
                <Textarea
                  className="mt-3 font-mono text-xs"
                  onChange={(event) => setClaimMapping(event.target.value)}
                  placeholder={'{"customer":"audience_id"}'}
                  value={claimMapping}
                />
                <Button className="mt-3" onClick={() => void saveJwt().catch((error) => toast.error(error.message))} type="button">
                  {t('settings.authentication.reader.jwtSave')}
                </Button>
                <div className="mt-5 border-t pt-4">
                  <Textarea
                    className="font-mono text-xs"
                    onChange={(event) => setTestToken(event.target.value)}
                    placeholder={t('settings.authentication.reader.jwtTestPlaceholder')}
                    value={testToken}
                  />
                  <Button
                    className="mt-2"
                    disabled={!testToken}
                    onClick={() =>
                      void testJwt
                        .mutateAsync(testToken)
                        .then((result) => toast.success(`${t('settings.authentication.reader.jwtValid')}: ${JSON.stringify(result)}`))
                        .catch((error) => toast.error(error.message))
                    }
                    type="button"
                    variant="outline"
                  >
                    {t('settings.authentication.reader.jwtTest')}
                  </Button>
                </div>
              </div>
            ) : null}
          </Panel>

          <Panel title={t('settings.authentication.reader.auditTitle')} description={t('settings.authentication.reader.auditDescription')}>
            <Button onClick={() => setShowAudit((value) => !value)} type="button" variant="outline">
              {showAudit ? t('settings.authentication.reader.auditHide') : t('settings.authentication.reader.auditReview')}
            </Button>
            {showAudit ? (
              <div className="mt-4">
                <Button
                  onClick={() =>
                    window.confirm(t('settings.authentication.reader.emergencyConfirm'))
                      ? void emergencyRevoke
                          .mutateAsync(undefined)
                          .then(() => {
                            toast.success(t('settings.authentication.reader.emergencySuccess'));
                          })
                          .catch((error) => toast.error(error.message))
                      : undefined
                  }
                  type="button"
                  variant="destructive"
                >
                  {t('settings.authentication.reader.emergencyAction')}
                </Button>
                <div className="mt-4 max-h-56 divide-y overflow-auto rounded-md border">
                  {(data?.audit ?? []).map((event) => (
                    <div className="flex justify-between gap-3 p-2 text-xs" key={event.id}>
                      <span>{event.action}</span>
                      <time className="text-muted-foreground">{new Date(event.createdAt).toLocaleString(locale)}</time>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </Panel>
        </>
      ) : (
        <div className="mt-6 rounded-xl border border-dashed p-6 text-center">
          <h3 className="font-semibold">{t('settings.authentication.reader.inactiveTitle')}</h3>
          <p className="mx-auto mt-1 max-w-xl text-muted-foreground text-sm">{t('settings.authentication.reader.inactiveDescription')}</p>
        </div>
      )}
    </div>
  );
}
