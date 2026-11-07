import { Button } from '@nibleaf/design-system/components/ui/button';
import { Skeleton, SkeletonListRow } from '@nibleaf/design-system/components/ui/skeleton';
import { useT } from '@nibleaf/i18n/react';
import { MCP_OAUTH_IDENTITY_SCOPES, type McpKeyPreset } from '@nibleaf/shared/mcp';
import { Check, ShieldCheck, TriangleAlert, X } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { QueryErrorState } from '@/components/query-error-state';
import { type McpOAuthAuthorization, useCreateMcpOAuthGrant, useMcpOAuthAuthorization } from '@/hooks/api';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { AuthLayout } from '@/layouts/auth';
import { consentLines, currentOAuthQuery, oauthStepHref } from '@/lib/mcp-oauth';
import { useSession } from '@/services/auth-client';

/** POST to a Better Auth OAuth endpoint with the page's signed query and go
 *  where it says: the next step, or back to the client with a code or error. */
async function resumeAuthorization(path: '/oauth2/continue' | '/oauth2/consent', body: Record<string, unknown>) {
  const response = await fetch(`/api/auth${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  });
  const result = (await response.json().catch(() => null)) as { url?: unknown } | null;
  if (!response.ok || typeof result?.url !== 'string') throw new Error('authorization_failed');
  window.location.assign(result.url);
}

/** The signed query is read after mount: it only exists in the browser URL. */
function useOAuthQuery() {
  const [query, setQuery] = useState<string | null | undefined>(undefined);
  useEffect(() => setQuery(currentOAuthQuery()), []);
  return query;
}

const presetKey = (preset: McpKeyPreset) => `settings.apiKeys.${preset}` as const;
const presetDescriptionKey = (preset: McpKeyPreset) => `settings.apiKeys.${preset}Description` as const;

function Notice({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'warning' }) {
  return (
    <p
      className={
        tone === 'error'
          ? 'rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive text-sm'
          : 'flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm'
      }
      role={tone === 'error' ? 'alert' : 'status'}
    >
      {tone === 'warning' ? <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-600" /> : null}
      <span className="min-w-0">{children}</span>
    </p>
  );
}

/**
 * Shared loading/session/expiry states for both steps. Renders `children`
 * with the authorization request once it is available.
 */
function AuthorizationGate({
  subtitle,
  children,
}: {
  subtitle: string;
  children: (authorization: McpOAuthAuthorization, oauthQuery: string) => ReactNode;
}) {
  const t = useT();
  const oauthQuery = useOAuthQuery();
  const { data: session, isPending } = useSession();
  const authorization = useMcpOAuthAuthorization(session && oauthQuery ? oauthQuery : null);

  if (oauthQuery === undefined || isPending || (session && oauthQuery && authorization.isPending)) {
    return (
      <AuthLayout subtitle={subtitle}>
        <section aria-busy="true" className="flex flex-col gap-4">
          <p className="sr-only" role="status">
            {t('common.loading')}
          </p>
          <Skeleton aria-hidden className="h-10 w-full" />
          <SkeletonListRow withIcon={false} />
          <SkeletonListRow withIcon={false} />
          <Skeleton aria-hidden className="mt-2 h-16 w-full" />
          <Skeleton aria-hidden className="h-16 w-full" />
        </section>
      </AuthLayout>
    );
  }
  if (!oauthQuery) {
    return (
      <AuthLayout subtitle={subtitle}>
        <Notice>{t('oauth.expired')}</Notice>
      </AuthLayout>
    );
  }
  if (!session) {
    return (
      <AuthLayout subtitle={subtitle}>
        <div className="flex flex-col gap-4">
          <p className="text-center text-muted-foreground text-sm">{t('oauth.signInAgain')}</p>
          <Button className="w-full" onClick={() => window.location.assign(oauthStepHref('/sign-in', window.location.search))} type="button">
            {t('auth.signIn.submit')}
          </Button>
        </div>
      </AuthLayout>
    );
  }
  if (authorization.isError || !authorization.data) {
    const expired = authorization.error instanceof ApiResponseError && authorization.error.status < 500;
    return (
      <AuthLayout subtitle={subtitle}>
        {expired ? (
          <Notice>{t('oauth.expired')}</Notice>
        ) : (
          <QueryErrorState onRetry={() => void authorization.refetch()} retrying={authorization.isFetching} />
        )}
      </AuthLayout>
    );
  }
  return <AuthLayout subtitle={subtitle}>{children(authorization.data, oauthQuery)}</AuthLayout>;
}

/** Names come from the client or the project owner; isolate them so a
 *  right-to-left sentence cannot reorder them (or be reordered by them). */
const isolate = (value: string) => `\u2068${value}\u2069`;
const clientLabel = (authorization: McpOAuthAuthorization, fallback: string) => isolate(authorization.client.name ?? fallback);

/** Step 1 (Better Auth's postLogin page): pick ONE project and a preset. */
export function McpOAuthProjectStep() {
  const t = useT();
  return (
    <AuthorizationGate subtitle={t('oauth.project.title')}>
      {(authorization, oauthQuery) => <ProjectForm authorization={authorization} oauthQuery={oauthQuery} />}
    </AuthorizationGate>
  );
}

function ProjectForm({ authorization, oauthQuery }: { authorization: McpOAuthAuthorization; oauthQuery: string }) {
  const t = useT();
  const create = useCreateMcpOAuthGrant(t('oauth.project.error'));
  const { projects, selection } = authorization;
  const [projectId, setProjectId] = useState<string | null>(selection?.project.id ?? (projects.length === 1 ? (projects[0]?.id ?? null) : null));
  const project = projects.find((candidate) => candidate.id === projectId) ?? null;
  const [preset, setPreset] = useState<McpKeyPreset>(selection?.preset ?? 'read_only');
  const [busy, setBusy] = useState<'continue' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const client = clientLabel(authorization, t('oauth.unknownClient'));
  const presetAllowed = Boolean(project?.presets.includes(preset));

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!(project && presetAllowed)) return;
    setBusy('continue');
    setError(null);
    try {
      await create.mutateAsync({ oauthQuery, projectId: project.id, preset });
      await resumeAuthorization('/oauth2/continue', { postLogin: true, oauth_query: oauthQuery });
    } catch {
      setError(t('oauth.project.error'));
      setBusy(null);
    }
  };

  const cancel = async () => {
    setBusy('cancel');
    setError(null);
    try {
      await resumeAuthorization('/oauth2/consent', { accept: false, oauth_query: oauthQuery });
    } catch {
      setError(t('oauth.consent.error'));
      setBusy(null);
    }
  };

  if (projects.length === 0) {
    return <Notice>{t('oauth.project.noProjects')}</Notice>;
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={submit}>
      <p className="text-muted-foreground text-sm leading-relaxed">{t('oauth.project.description', { client })}</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-medium text-sm">{t('oauth.project.projectLabel')}</legend>
        {projects.map((candidate) => (
          <label
            className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            key={candidate.id}
          >
            <input
              checked={projectId === candidate.id}
              name="mcp-oauth-project"
              onChange={() => {
                setProjectId(candidate.id);
                if (!candidate.presets.includes(preset)) setPreset('read_only');
              }}
              type="radio"
            />
            <span className="flex min-w-0 flex-1 flex-col">
              <bdi className="truncate font-medium">{candidate.name}</bdi>
              <bdi className="truncate text-muted-foreground text-xs">
                {candidate.workspace} · {candidate.slug}
              </bdi>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 font-medium text-sm">{t('oauth.project.permissionLabel')}</legend>
        {(['read_only', 'support_writer', 'full_admin'] as const).map((value) => {
          const allowed = project ? project.presets.includes(value) : value !== 'full_admin';
          return (
            <label
              className="flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"
              key={value}
            >
              <input
                checked={preset === value}
                className="mt-1"
                disabled={!allowed}
                name="mcp-oauth-preset"
                onChange={() => setPreset(value)}
                type="radio"
              />
              <span className="min-w-0">
                <span className="block font-medium">{t(presetKey(value))}</span>
                <span className="mt-1 block text-muted-foreground">{t(presetDescriptionKey(value))}</span>
                {allowed ? null : <span className="mt-1 block text-muted-foreground text-xs">{t('settings.apiKeys.adminOnly')}</span>}
              </span>
            </label>
          );
        })}
      </fieldset>
      {error ? <Notice>{error}</Notice> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          disabled={busy === 'continue'}
          loading={busy === 'cancel'}
          loadingText={t('oauth.project.cancelling')}
          onClick={() => void cancel()}
          type="button"
          variant="outline"
        >
          {t('oauth.project.cancel')}
        </Button>
        <Button
          disabled={busy === 'cancel' || !project || !presetAllowed}
          loading={busy === 'continue'}
          loadingText={t('oauth.project.continuing')}
          type="submit"
        >
          {t('oauth.project.continue')}
        </Button>
      </div>
    </form>
  );
}

/** Step 2 (Better Auth's consent page): what the app will be able to do. */
export function McpOAuthConsentStep() {
  const t = useT();
  return (
    <AuthorizationGate subtitle={t('oauth.consent.title')}>
      {(authorization, oauthQuery) => <ConsentForm authorization={authorization} oauthQuery={oauthQuery} />}
    </AuthorizationGate>
  );
}

const IDENTITY_SCOPES = new Set<string>(MCP_OAUTH_IDENTITY_SCOPES);

function ConsentForm({ authorization, oauthQuery }: { authorization: McpOAuthAuthorization; oauthQuery: string }) {
  const t = useT();
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { selection, client: info } = authorization;
  const client = clientLabel(authorization, t('oauth.unknownClient'));

  if (!selection) {
    return (
      <div className="flex flex-col gap-4">
        <Notice>{t('oauth.consent.noProject')}</Notice>
        <Button className="w-full" nativeButton={false} render={<a href={oauthStepHref('/oauth/project', window.location.search)} />}>
          {t('oauth.consent.changeProject')}
        </Button>
      </div>
    );
  }

  const { can, cannot } = consentLines(selection.scopes);
  // The token carries no more than the chosen preset (plus sign-in scopes such
  // as offline_access), so its scope matches what this page promised.
  const granted = authorization.requestedScopes.filter((scope) => selection.scopes.includes(scope) || IDENTITY_SCOPES.has(scope));

  const decide = async (accept: boolean) => {
    setBusy(accept ? 'allow' : 'deny');
    setError(null);
    try {
      await resumeAuthorization('/oauth2/consent', {
        accept,
        ...(accept && granted.includes('mcp:connect') ? { scope: granted.join(' ') } : {}),
        oauth_query: oauthQuery,
      });
    } catch {
      setError(t('oauth.consent.error'));
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <p className="font-medium text-base leading-snug">{t('oauth.consent.summary', { client, project: isolate(selection.project.name) })}</p>
        <p className="flex items-center gap-1.5 text-muted-foreground text-sm">
          <ShieldCheck aria-hidden className="size-4 shrink-0 text-primary" />
          {t('oauth.consent.permission', { preset: t(presetKey(selection.preset)) })}
        </p>
        {info.verifiedDomain ? (
          <p className="text-muted-foreground text-xs">
            {t('oauth.consent.verifiedBy')} <bdi dir="ltr">{info.verifiedDomain}</bdi>
          </p>
        ) : (
          <Notice tone="warning">{t('oauth.consent.unverified')}</Notice>
        )}
        {info.redirectTarget ? (
          <p className="text-muted-foreground text-xs">
            {t('oauth.consent.returnsTo')} <bdi dir="ltr">{info.redirectTarget}</bdi>
          </p>
        ) : null}
      </div>
      <section className="flex flex-col gap-2">
        <h2 className="font-medium text-sm">{t('oauth.consent.canHeading')}</h2>
        <ul className="flex flex-col gap-1.5 text-sm">
          {can.map((line) => (
            <li className="flex items-start gap-2" key={line}>
              <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              <span className="min-w-0">{t(line)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-medium text-sm">{t('oauth.consent.cannotHeading')}</h2>
        <ul className="flex flex-col gap-1.5 text-sm">
          {cannot.map((line) => (
            <li className="flex items-start gap-2" key={line}>
              <X aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0">{t(line)}</span>
            </li>
          ))}
        </ul>
      </section>
      <p className="text-muted-foreground text-xs">{t('oauth.consent.revokeHint')}</p>
      {error ? <Notice>{error}</Notice> : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <a className="text-center text-primary text-sm hover:underline" href={oauthStepHref('/oauth/project', window.location.search)}>
          {t('oauth.consent.changeProject')}
        </a>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button
            disabled={busy === 'allow'}
            loading={busy === 'deny'}
            loadingText={t('oauth.consent.denying')}
            onClick={() => void decide(false)}
            type="button"
            variant="outline"
          >
            {t('oauth.consent.deny')}
          </Button>
          <Button
            disabled={busy === 'deny'}
            loading={busy === 'allow'}
            loadingText={t('oauth.consent.allowing')}
            onClick={() => void decide(true)}
            type="button"
          >
            {t('oauth.consent.allow')}
          </Button>
        </div>
      </div>
    </div>
  );
}
