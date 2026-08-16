import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { Project } from '@/hooks/api';
import { usePages } from '@/hooks/api';
import { useT } from '@/lib/i18n';
import { Field, SectionHeader, Segmented } from './shared';

type AccessMode = 'PUBLIC' | 'WORKSPACE' | 'READERS';
interface Audience {
  id: string;
  name: string;
  grants: Array<{ pageId: string | null }>;
  _count: { readers: number };
}
interface Reader {
  id: string;
  email: string | null;
  name: string | null;
  status: string;
  audiences: Array<{ audience: { id: string; name: string } }>;
  _count: { sessions: number };
}
interface AuditEvent {
  id: string;
  action: string;
  createdAt: string;
}
interface JwtConfiguration {
  enabled: boolean;
  issuer: string;
  audience: string;
  jwksUrl: string | null;
  publicJwks: unknown;
  groupsClaim: string;
  claimMapping: unknown;
  sessionTtlMinutes: number;
  maxTokenAgeSeconds: number;
  clockToleranceSecs: number;
}
interface ReaderAccessData {
  accessMode: AccessMode;
  readers: Reader[];
  audiences: Audience[];
  jwt: JwtConfiguration | null;
  audit: AuditEvent[];
}

const request = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, { credentials: 'include', ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = (await response.json().catch(() => ({}))) as { data?: T; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || `Request failed (${response.status})`);
  return body.data as T;
};

const Panel = ({ title, description, children }: { title: string; description: string; children: ReactNode }) => (
  <section className="mt-8 rounded-lg border border-border p-4">
    <h3 className="font-semibold text-sm">{title}</h3>
    <p className="mt-1 mb-4 text-muted-foreground text-xs">{description}</p>
    {children}
  </section>
);

export function AuthenticationSection({ project }: { project: Project }) {
  const t = useT();
  const { data: pages = [] } = usePages(project.id);
  const [data, setData] = useState<ReaderAccessData | null>(null);
  const [loading, setLoading] = useState(true);
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
  const base = `/api/app/projects/${encodeURIComponent(project.id)}/reader-access`;

  const refresh = useCallback(async () => {
    try {
      const next = await request<ReaderAccessData>(base);
      setData(next);
      setMode(next.accessMode);
      if (next.jwt) {
        setJwtEnabled(next.jwt.enabled);
        setIssuer(next.jwt.issuer);
        setJwtAudience(next.jwt.audience);
        setJwksUrl(next.jwt.jwksUrl ?? '');
        setPublicJwks(next.jwt.publicJwks ? JSON.stringify(next.jwt.publicJwks, null, 2) : '');
        setGroupsClaim(next.jwt.groupsClaim);
        setClaimMapping(JSON.stringify(next.jwt.claimMapping ?? {}, null, 2));
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load reader access.');
    } finally {
      setLoading(false);
    }
  }, [base]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const pageOptions = useMemo(() => pages.filter((page) => page.kind === 'PAGE'), [pages]);

  const saveMode = async () => {
    await request(`${base}/mode`, { method: 'PUT', body: JSON.stringify({ mode }) });
    toast.success('Access mode updated.');
    await refresh();
  };
  const addAudience = async () => {
    await request(`${base}/audiences`, { method: 'POST', body: JSON.stringify({ name: audienceName, pageIds: audiencePages }) });
    setAudienceName('');
    setAudiencePages([]);
    toast.success('Audience created.');
    await refresh();
  };
  const invite = async () => {
    const result = await request<{ activationUrl: string }>(`${base}/readers/invite`, {
      method: 'POST',
      body: JSON.stringify({ email: readerEmail, ...(readerName ? { name: readerName } : {}), audienceIds: readerAudiences }),
    });
    setReaderEmail('');
    setReaderName('');
    if (navigator.clipboard) await navigator.clipboard.writeText(result.activationUrl).catch(() => undefined);
    toast.success('Reader invited. The one-time link was copied when clipboard access was available.');
    await refresh();
  };
  const saveJwt = async () => {
    let mapping: Record<string, string>;
    let keys: unknown;
    try {
      mapping = JSON.parse(claimMapping) as Record<string, string>;
      keys = publicJwks.trim() ? JSON.parse(publicJwks) : null;
    } catch {
      toast.error('JWKS and claim mapping must be valid JSON.');
      return;
    }
    await request(`${base}/jwt`, {
      method: 'PUT',
      body: JSON.stringify({
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
    });
    toast.success('JWT configuration saved.');
    await refresh();
  };

  return (
    <div>
      <SectionHeader description={t('settings.authentication.description')} icon="◉" title={t('settings.authentication.title')} />
      <Field
        hint="Public is the backward-compatible default. Workspace requires an author account. Readers uses dedicated identities and audiences."
        label="Access mode"
      >
        <Segmented
          className="max-w-[540px]"
          onChange={setMode}
          options={[
            { value: 'PUBLIC', label: 'Public' },
            { value: 'WORKSPACE', label: 'Workspace members' },
            { value: 'READERS', label: 'Private readers' },
          ]}
          value={mode}
        />
        <Button className="mt-3" disabled={loading} onClick={() => void saveMode().catch((error) => toast.error(error.message))} type="button">
          Save access mode
        </Button>
      </Field>

      {data?.accessMode === 'READERS' ? (
        <>
          <Panel
            title="Audiences and content rules"
            description="Grant an audience the whole site, or select individual pages. Navigation and search are filtered server-side."
          >
            <div className="grid gap-3 md:grid-cols-2">
              <Input onChange={(event) => setAudienceName(event.target.value)} placeholder="Customers" value={audienceName} />
              <select
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
            <p className="mt-2 text-muted-foreground text-xs">Leave every page unselected to grant the entire site.</p>
            <Button
              className="mt-3"
              disabled={!audienceName.trim()}
              onClick={() => void addAudience().catch((error) => toast.error(error.message))}
              type="button"
            >
              Create audience
            </Button>
            <div className="mt-4 divide-y rounded-md border">
              {(data?.audiences ?? []).map((audience) => (
                <div className="flex items-center justify-between gap-3 p-3 text-sm" key={audience.id}>
                  <div>
                    <div className="font-medium">{audience.name}</div>
                    <div className="text-muted-foreground text-xs">
                      {audience.grants.some((grant) => !grant.pageId) ? 'Entire site' : `${audience.grants.length} pages`} · {audience._count.readers}{' '}
                      readers
                    </div>
                  </div>
                  <Button
                    onClick={() =>
                      window.confirm(`Delete the ${audience.name} audience and remove its reader assignments?`)
                        ? void request(`${base}/audiences/${audience.id}`, { method: 'DELETE' })
                            .then(refresh)
                            .catch((error) => toast.error(error.message))
                        : undefined
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Delete
                  </Button>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            title="Dedicated readers"
            description="Readers do not receive dashboard access or author seats. Invitations are single-use and expire after seven days."
          >
            <div className="grid gap-3 md:grid-cols-3">
              <Input onChange={(event) => setReaderEmail(event.target.value)} placeholder="reader@example.com" type="email" value={readerEmail} />
              <Input onChange={(event) => setReaderName(event.target.value)} placeholder="Name (optional)" value={readerName} />
              <select
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
              Invite reader
            </Button>
            <div className="mt-4 divide-y rounded-md border">
              {(data?.readers ?? []).map((reader) => (
                <div className="flex items-center justify-between gap-3 p-3 text-sm" key={reader.id}>
                  <div>
                    <div className="font-medium">{reader.name || reader.email || 'Portal reader'}</div>
                    <div className="text-muted-foreground text-xs">
                      {reader.status} · {reader.audiences.map((item) => item.audience.name).join(', ')} · {reader._count.sessions} active sessions
                    </div>
                  </div>
                  <Button
                    disabled={reader.status === 'REVOKED'}
                    onClick={() =>
                      window.confirm(`Revoke access and active sessions for ${reader.name || reader.email || 'this reader'}?`)
                        ? void request(`${base}/readers/${reader.id}/revoke`, { method: 'POST' })
                            .then(refresh)
                            .catch((error) => toast.error(error.message))
                        : undefined
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Revoke
                  </Button>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            title="JWT portal handoff"
            description="Accept short-lived asymmetric JWTs. Issuer, audience, expiry, signature, token age, jti replay, and claims are verified."
          >
            <Button onClick={() => setShowJwt((value) => !value)} type="button" variant="outline">
              {showJwt ? 'Hide JWT configuration' : jwtEnabled ? 'Manage JWT configuration' : 'Configure JWT handoff'}
            </Button>
            {showJwt ? (
              <div className="mt-4">
                <label className="mb-3 flex items-center gap-2 text-sm">
                  <input checked={jwtEnabled} onChange={(event) => setJwtEnabled(event.target.checked)} type="checkbox" /> Enable JWT handoff
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
                  placeholder="Or paste a public JWKS (never a private key)"
                  value={publicJwks}
                />
                <Textarea
                  className="mt-3 font-mono text-xs"
                  onChange={(event) => setClaimMapping(event.target.value)}
                  placeholder={'{"customer":"audience_id"}'}
                  value={claimMapping}
                />
                <Button className="mt-3" onClick={() => void saveJwt().catch((error) => toast.error(error.message))} type="button">
                  Save JWT configuration
                </Button>
                <div className="mt-5 border-t pt-4">
                  <Textarea
                    className="font-mono text-xs"
                    onChange={(event) => setTestToken(event.target.value)}
                    placeholder="Paste a signed test JWT; it is validated but never stored"
                    value={testToken}
                  />
                  <Button
                    className="mt-2"
                    disabled={!testToken}
                    onClick={() =>
                      void request(`${base}/jwt/test`, { method: 'POST', body: JSON.stringify({ token: testToken }) })
                        .then((result) => toast.success(`JWT valid: ${JSON.stringify(result)}`))
                        .catch((error) => toast.error(error.message))
                    }
                    type="button"
                    variant="outline"
                  >
                    Test JWT
                  </Button>
                </div>
              </div>
            ) : null}
          </Panel>

          <Panel title="Audit and emergency revocation" description="Security-sensitive actions are retained without tokens, JWTs, or keys.">
            <Button onClick={() => setShowAudit((value) => !value)} type="button" variant="outline">
              {showAudit ? 'Hide security activity' : 'Review security activity'}
            </Button>
            {showAudit ? (
              <div className="mt-4">
                <Button
                  onClick={() =>
                    window.confirm('Emergency revoke every reader session and disable JWT handoff? Readers will immediately lose access.')
                      ? void request(`${base}/emergency-revoke`, { method: 'POST' })
                          .then(() => {
                            toast.success('All reader sessions revoked and JWT handoff disabled.');
                            return refresh();
                          })
                          .catch((error) => toast.error(error.message))
                      : undefined
                  }
                  type="button"
                  variant="destructive"
                >
                  Emergency revoke all access
                </Button>
                <div className="mt-4 max-h-56 divide-y overflow-auto rounded-md border">
                  {(data?.audit ?? []).map((event) => (
                    <div className="flex justify-between gap-3 p-2 text-xs" key={event.id}>
                      <span>{event.action}</span>
                      <time className="text-muted-foreground">{new Date(event.createdAt).toLocaleString()}</time>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </Panel>
        </>
      ) : (
        <div className="mt-6 rounded-xl border border-dashed p-6 text-center">
          <h3 className="font-semibold">Reader controls are inactive</h3>
          <p className="mx-auto mt-1 max-w-xl text-muted-foreground text-sm">
            Choose Private readers and save the access mode before creating audiences, invitations, or a portal handoff. Existing reader records
            remain stored when another mode is active.
          </p>
        </div>
      )}
    </div>
  );
}
