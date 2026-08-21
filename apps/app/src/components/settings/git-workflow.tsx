import { Alert, AlertDescription, AlertTitle } from '@nibleaf/design-system/components/ui/alert';
import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  GitCommit,
  GitCompare,
  GitPullRequest,
  RefreshCw,
  Settings2,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { API_URL } from '@/lib/api';

type Conflict = { id: string; path: string; status: string; baseContent: string | null; oursContent: string | null; theirsContent: string | null };
type Operation = {
  id: string;
  kind: string;
  status: string;
  commitMessage: string | null;
  changedFiles: Array<{ path: string; status: string }> | null;
  pullRequestNo: number | null;
  pullRequestUrl: string | null;
  error: string | null;
  createdAt: string;
  conflicts: Conflict[];
};
type Preview = { id: string; status: string; url: string | null; error: string | null };
type PullRequest = { id: string; number: number; url: string; title: string; draft: boolean; state: string; previews: Preview[] };
type GitStatus = {
  id: string;
  repository: string;
  baseBranch: string;
  headBranch: string;
  contentPath: string;
  credentialConfigured: boolean;
  webhookConfigured: boolean;
  lastSyncStatus: string;
  lastSyncError: string | null;
  lastSyncedAt: string | null;
  operations: Operation[];
  pullRequests: PullRequest[];
  files: Array<{ path: string }>;
};
type GitIdentity = { login: string; name: string | null };

const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    credentials: 'include',
  });
  const body = (await response.json().catch(() => ({}))) as { data?: T; error?: { message?: string }; message?: string };
  if (!response.ok) throw new Error(body.error?.message ?? body.message ?? `Request failed (${response.status}).`);
  return body.data as T;
};

const keyFor = (projectId: string) => ['git-workflow', projectId] as const;
const statusTone = (status: string): 'default' | 'secondary' | 'destructive' | 'outline' =>
  status === 'FAILED' || status === 'CONFLICT' ? 'destructive' : status === 'SUCCEEDED' || status === 'READY' ? 'default' : 'secondary';

function ConflictCard({ projectId, conflict }: { projectId: string; conflict: Conflict }) {
  const client = useQueryClient();
  const [custom, setCustom] = useState(conflict.oursContent ?? '');
  const resolve = useMutation({
    mutationFn: (body: { resolution: 'OURS' | 'THEIRS' | 'CUSTOM'; content?: string | null }) =>
      request(`/api/app/projects/${projectId}/git/conflicts/${conflict.id}/resolve`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => client.invalidateQueries({ queryKey: keyFor(projectId) }),
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not resolve conflict.'),
  });
  return (
    <section className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="mb-3 flex items-center justify-between">
        <code className="text-sm">{conflict.path}</code>
        <Badge variant="destructive">Conflict</Badge>
      </div>
      <div className="grid gap-3 xl:grid-cols-3">
        {(
          [
            ['Base', conflict.baseContent],
            ['Nibleaf', conflict.oursContent],
            ['Git', conflict.theirsContent],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <Label>{label}</Label>
            <pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap rounded-md border bg-background p-3 text-xs">
              {value ?? '∅ file deleted'}
            </pre>
          </div>
        ))}
      </div>
      <Label className="mt-3" htmlFor={`custom-${conflict.id}`}>
        Custom resolution
      </Label>
      <Textarea
        className="mt-1 min-h-32 font-mono text-xs"
        id={`custom-${conflict.id}`}
        onChange={(event) => setCustom(event.target.value)}
        value={custom}
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={resolve.isPending} onClick={() => resolve.mutate({ resolution: 'OURS' })} size="sm">
          Use Nibleaf
        </Button>
        <Button disabled={resolve.isPending} onClick={() => resolve.mutate({ resolution: 'THEIRS' })} size="sm" variant="outline">
          Use Git
        </Button>
        <Button disabled={resolve.isPending} onClick={() => resolve.mutate({ resolution: 'CUSTOM', content: custom })} size="sm" variant="secondary">
          Use custom
        </Button>
        <Button disabled={resolve.isPending} onClick={() => resolve.mutate({ resolution: 'CUSTOM', content: null })} size="sm" variant="destructive">
          Delete file
        </Button>
      </div>
    </section>
  );
}

export function GitWorkflow({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const [repository, setRepository] = useState('');
  const [baseBranch, setBaseBranch] = useState('main');
  const [headBranch, setHeadBranch] = useState('nibleaf/docs');
  const [contentPath, setContentPath] = useState('docs');
  const [token, setToken] = useState('');
  const [authorizedAccount, setAuthorizedAccount] = useState<GitIdentity | null>(null);
  const [message, setMessage] = useState('Update documentation');
  const [authorName, setAuthorName] = useState('Nibleaf author');
  const [authorEmail, setAuthorEmail] = useState('docs@example.com');
  const [prTitle, setPrTitle] = useState('Update documentation');
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);
  const [connectStep, setConnectStep] = useState<1 | 2 | 3>(1);
  const [intent, setIntent] = useState<'overview' | 'sync' | 'publish' | 'connection'>('overview');
  const query = useQuery({
    queryKey: keyFor(projectId),
    queryFn: () => request<GitStatus | null>(`/api/app/projects/${projectId}/git`),
    refetchInterval: (state) => (state.state.data?.operations.some((operation) => ['QUEUED', 'RUNNING'].includes(operation.status)) ? 2500 : false),
  });
  const connection = query.data;
  const authorize = useMutation({
    mutationFn: () =>
      request<GitIdentity>(`/api/app/projects/${projectId}/git/authorize`, {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    onSuccess: (identity) => {
      setAuthorizedAccount(identity);
      setConnectStep(2);
    },
  });
  const connect = useMutation({
    mutationFn: () =>
      request<{ connection: GitStatus; webhookSecret: string | null }>(`/api/app/projects/${projectId}/git/connection`, {
        method: 'PUT',
        body: JSON.stringify({ repository, baseBranch, headBranch, contentPath, token: token || undefined }),
      }),
    onSuccess: (data) => {
      setWebhookSecret(data.webhookSecret);
      setToken('');
      setAuthorizedAccount(null);
      client.invalidateQueries({ queryKey: keyFor(projectId) });
      toast.success('GitHub connection saved.');
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not connect GitHub.'),
  });
  const disconnect = useMutation({
    mutationFn: () => request<{ disconnected: boolean }>(`/api/app/projects/${projectId}/git/connection`, { method: 'DELETE' }),
    onSuccess: () => {
      client.setQueryData(keyFor(projectId), null);
      toast.success('GitHub disconnected and encrypted credentials removed.');
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not disconnect GitHub.'),
  });
  const operation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      request<Operation>(`/api/app/projects/${projectId}/git/operations`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => client.invalidateQueries({ queryKey: keyFor(projectId) }),
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not queue Git operation.'),
  });
  const rotate = useMutation({
    mutationFn: () => request<{ webhookSecret: string }>(`/api/app/projects/${projectId}/git/webhook-secret`, { method: 'POST' }),
    onSuccess: (data) => setWebhookSecret(data.webhookSecret),
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not rotate webhook secret.'),
  });
  const activeConflicts = useMemo(
    () => connection?.operations.flatMap((item) => item.conflicts.filter((conflict) => conflict.status === 'OPEN')) ?? [],
    [connection],
  );
  const webhookUrl = typeof window === 'undefined' ? '' : `${window.location.origin}/api/public/git/webhook/${projectId}`;

  useEffect(() => {
    if (!connection) return;
    setRepository(connection.repository);
    setBaseBranch(connection.baseBranch);
    setHeadBranch(connection.headBranch);
    setContentPath(connection.contentPath);
  }, [connection]);

  if (query.isPending)
    return (
      <div aria-live="polite" className="rounded-xl border p-5 text-muted-foreground text-sm">
        Loading Git connection…
      </div>
    );
  if (query.isError) {
    return (
      <Alert variant="destructive">
        <AlertTriangle />
        <AlertTitle>Git connection could not be loaded</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
          <span>{query.error instanceof Error ? query.error.message : 'Try again or check the server connection.'}</span>
          <Button onClick={() => query.refetch()} size="sm" variant="outline">
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (!connection) {
    return (
      <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <header className="border-border border-b bg-muted/20 px-5 py-5 sm:px-6">
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
              <ShieldCheck className="size-5 text-primary" />
            </span>
            <div className="space-y-1">
              <h2 className="font-semibold text-base">Connect GitHub</h2>
              <p className="max-w-2xl text-muted-foreground text-sm leading-6">
                Bring existing docs into Nibleaf, keep changes in sync, and publish reviewable pull requests.
              </p>
            </div>
          </div>
        </header>

        <div className="space-y-6 p-5 sm:p-6">
          <ol aria-label="Connection progress" className="grid gap-3 sm:grid-cols-3">
            {(
              [
                ['Authorize', 'Verify your account'],
                ['Repository', 'Choose the source'],
                ['Review', 'Confirm the setup'],
              ] as const
            ).map(([label, description], index) => {
              const step = (index + 1) as 1 | 2 | 3;
              const isActive = connectStep === step;
              const isComplete = connectStep > step;
              return (
                <li
                  aria-current={isActive ? 'step' : undefined}
                  className={`flex min-h-16 items-center gap-3 rounded-xl border p-3 ${
                    isActive
                      ? 'border-primary/50 bg-primary/5 text-foreground shadow-sm'
                      : isComplete
                        ? 'border-border bg-muted/30 text-foreground'
                        : 'border-border/80 bg-muted/10 text-muted-foreground'
                  }`}
                  key={label}
                >
                  <span
                    className={`flex size-7 shrink-0 items-center justify-center rounded-full font-semibold text-xs ${
                      isActive || isComplete ? 'bg-primary text-primary-foreground' : 'border border-border bg-background'
                    }`}
                  >
                    {isComplete ? <Check aria-hidden="true" className="size-4" /> : step}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-medium text-sm leading-5">{label}</span>
                    <span className="block text-muted-foreground text-xs leading-4">{description}</span>
                  </span>
                </li>
              );
            })}
          </ol>

          <div className="rounded-xl border border-border bg-background p-5 shadow-sm sm:p-6">
            {connectStep === 1 ? (
              <div className="max-w-2xl space-y-5">
                <div className="space-y-1.5">
                  <h3 className="font-medium text-sm">Authorize the provider</h3>
                  <p className="text-muted-foreground text-sm leading-6">
                    Use a fine-grained GitHub token with Metadata read, Contents read/write, and Pull requests read/write. We verify your identity now
                    and encrypt the token only after you confirm the connection.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="git2-token">Fine-grained token</Label>
                  <Input
                    autoComplete="off"
                    id="git2-token"
                    onChange={(e) => {
                      setToken(e.target.value);
                      setAuthorizedAccount(null);
                    }}
                    placeholder="github_pat_…"
                    type="password"
                    value={token}
                  />
                </div>
                {authorize.isError ? (
                  <p aria-live="polite" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-destructive text-sm">
                    {authorize.error instanceof Error ? authorize.error.message : 'GitHub could not be authorized. Check the token and try again.'}
                  </p>
                ) : null}
              </div>
            ) : null}
            {connectStep === 2 ? (
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <h3 className="font-medium text-sm">Choose repository and branches</h3>
                  <p className="text-muted-foreground text-sm leading-6">
                    Select where Nibleaf reads your docs and where it writes changes for review.
                  </p>
                </div>
                <div className="grid gap-5 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="git2-repo">Repository</Label>
                    <Input id="git2-repo" onChange={(e) => setRepository(e.target.value)} placeholder="owner/docs" value={repository} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="git2-base">Base branch</Label>
                    <Input id="git2-base" onChange={(e) => setBaseBranch(e.target.value)} value={baseBranch} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="git2-head">Dedicated Nibleaf branch</Label>
                    <Input id="git2-head" onChange={(e) => setHeadBranch(e.target.value)} value={headBranch} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="git2-path">Content path</Label>
                    <Input id="git2-path" onChange={(e) => setContentPath(e.target.value)} value={contentPath} />
                  </div>
                </div>
              </div>
            ) : null}
            {connectStep === 3 ? (
              <div className="space-y-5">
                <div className="space-y-1.5">
                  <h3 className="font-medium text-sm">Review connection</h3>
                  <p className="text-muted-foreground text-sm leading-6">Confirm the account, source, and write destination before connecting.</p>
                </div>
                {authorizedAccount ? (
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm">
                    <span>
                      GitHub authorized as <strong>@{authorizedAccount.login}</strong>
                      {authorizedAccount.name ? <span className="text-muted-foreground"> · {authorizedAccount.name}</span> : null}
                    </span>
                    <Badge variant="outline">Verified</Badge>
                  </div>
                ) : null}
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  {(
                    [
                      ['Repository', repository],
                      ['Docs path', contentPath || '/'],
                      ['Import from', baseBranch],
                      ['Write changes to', headBranch],
                    ] as const
                  ).map(([label, value]) => (
                    <div className="rounded-lg border border-border bg-muted/20 p-3" key={label}>
                      <dt className="text-muted-foreground text-xs">{label}</dt>
                      <dd className="mt-1 break-all font-mono">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-muted-foreground text-xs leading-5">
                  Connecting verifies repository access and stores the credential. Import and sync remain separate actions after connection.
                </p>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col-reverse gap-3 border-border border-t pt-5 sm:flex-row sm:items-center sm:justify-between">
            <Button
              className="w-full sm:w-auto"
              disabled={connectStep === 1}
              onClick={() => setConnectStep((step) => Math.max(1, step - 1) as 1 | 2 | 3)}
              variant="outline"
            >
              <ArrowLeft className="size-4" /> Back
            </Button>
            {connectStep < 3 ? (
              connectStep === 1 ? (
                <Button className="w-full sm:w-auto" disabled={authorize.isPending || token.trim().length < 20} onClick={() => authorize.mutate()}>
                  {authorize.isPending ? 'Authorizing GitHub…' : 'Authorize GitHub'} <ArrowRight className="size-4" />
                </Button>
              ) : (
                <Button
                  className="w-full sm:w-auto"
                  disabled={!authorizedAccount || !repository.trim() || !baseBranch.trim() || !headBranch.trim()}
                  onClick={() => setConnectStep(3)}
                >
                  Review connection <ArrowRight className="size-4" />
                </Button>
              )
            ) : (
              <Button
                className="w-full sm:w-auto"
                disabled={connect.isPending || !authorizedAccount || !repository || !token}
                onClick={() => connect.mutate()}
              >
                {connect.isPending ? 'Verifying connection…' : 'Connect GitHub'}
              </Button>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border border-primary/20 bg-primary/5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <GitCompare className="size-5 text-primary" />
              <h2 className="font-semibold">Two-way Git workflow</h2>
              <Badge variant={statusTone(connection.lastSyncStatus)}>{connection.lastSyncStatus}</Badge>
            </div>
            <p className="mt-1 font-mono text-sm">
              {connection.repository}: {connection.headBranch} → {connection.baseBranch}
            </p>
          </div>
          <Button onClick={() => query.refetch()} size="sm" variant="outline">
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>
        {connection.lastSyncError ? (
          <Alert className="mt-4" variant="destructive">
            <AlertTriangle />
            <AlertTitle>Last sync failed</AlertTitle>
            <AlertDescription>{connection.lastSyncError}</AlertDescription>
          </Alert>
        ) : null}
      </section>

      <nav aria-label="Git workflow actions" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ['overview', 'Status & activity', 'Health, previews, and recent runs'],
            ['sync', 'Import & sync', 'Pull repository changes into Nibleaf'],
            ['publish', 'Create or update PR', 'Push saved docs for review'],
            ['connection', 'Connection settings', 'Branches, webhook, and disconnect'],
          ] as const
        ).map(([value, label, description]) => (
          <button
            aria-pressed={intent === value}
            className={`rounded-lg border p-3 text-start transition-colors ${intent === value ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'}`}
            key={value}
            onClick={() => setIntent(value)}
            type="button"
          >
            <span className="block font-medium text-sm">{label}</span>
            <span className="mt-1 block text-muted-foreground text-xs">{description}</span>
          </button>
        ))}
      </nav>

      {activeConflicts.length > 0 ? (
        <section className="space-y-3">
          <div>
            <h3 className="font-semibold">Reconcile conflicts</h3>
            <p className="text-muted-foreground text-sm">
              Review base, Nibleaf, and Git. Nothing is overwritten until every file has an explicit resolution.
            </p>
          </div>
          {activeConflicts.map((conflict) => (
            <ConflictCard conflict={conflict} key={conflict.id} projectId={projectId} />
          ))}
        </section>
      ) : null}

      {intent === 'sync' ? (
        <section className="rounded-xl border p-5">
          <div className="flex items-center gap-2">
            <RefreshCw className="size-5" />
            <h3 className="font-semibold">Import and sync repository changes</h3>
          </div>
          <p className="mt-1 text-muted-foreground text-sm">
            Pull from <code>{connection.baseBranch}</code>, compare it with Nibleaf’s last common baseline, and review conflicts before anything is
            overwritten.
          </p>
          <Button
            className="mt-4"
            disabled={operation.isPending || activeConflicts.length > 0}
            onClick={() => operation.mutate({ idempotencyKey: crypto.randomUUID(), kind: 'PULL', sourceRef: connection.baseBranch })}
          >
            <RefreshCw className={`size-4 ${operation.isPending ? 'animate-spin' : ''}`} />{' '}
            {connection.lastSyncedAt ? 'Sync latest changes' : 'Import existing docs'}
          </Button>
          {activeConflicts.length > 0 ? (
            <p className="mt-2 text-amber-700 text-xs dark:text-amber-300">Resolve the open conflicts above before starting another sync.</p>
          ) : null}
        </section>
      ) : null}

      {intent === 'publish' ? (
        <section className="rounded-xl border p-5">
          <div className="flex items-center gap-2">
            <GitCommit className="size-5" />
            <h3 className="font-semibold">Commit and draft pull request</h3>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <Label htmlFor="git2-message">Commit message</Label>
              <Input id="git2-message" onChange={(e) => setMessage(e.target.value)} value={message} />
            </div>
            <div>
              <Label htmlFor="git2-author">Author name</Label>
              <Input id="git2-author" onChange={(e) => setAuthorName(e.target.value)} value={authorName} />
            </div>
            <div>
              <Label htmlFor="git2-email">Author email</Label>
              <Input id="git2-email" onChange={(e) => setAuthorEmail(e.target.value)} type="email" value={authorEmail} />
            </div>
            <div className="md:col-span-2">
              <Label htmlFor="git2-title">Pull request title</Label>
              <Input id="git2-title" onChange={(e) => setPrTitle(e.target.value)} value={prTitle} />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              disabled={operation.isPending}
              onClick={() =>
                operation.mutate({
                  idempotencyKey: crypto.randomUUID(),
                  kind: 'PUSH',
                  commitMessage: message,
                  authorName,
                  authorEmail,
                  createPullRequest: true,
                  pullRequestTitle: prTitle,
                })
              }
            >
              <GitPullRequest className="size-4" /> Commit & update draft PR
            </Button>
          </div>
        </section>
      ) : null}

      {intent === 'overview' || intent === 'publish' ? (
        <section className="rounded-xl border p-5">
          <h3 className="font-semibold">Pull requests and previews</h3>
          <div className="mt-3 space-y-2">
            {connection.pullRequests.length ? (
              connection.pullRequests.map((pull) => {
                const preview = pull.previews[0];
                return (
                  <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3" key={pull.id}>
                    <Badge variant={pull.draft ? 'secondary' : 'outline'}>{pull.draft ? 'Draft' : pull.state}</Badge>
                    <a className="font-medium text-sm underline" href={pull.url} rel="noreferrer" target="_blank">
                      #{pull.number} {pull.title} <ArrowUpRight className="inline size-3" />
                    </a>
                    <span className="ms-auto text-muted-foreground text-xs">Preview: {preview?.status ?? 'pending'}</span>
                    {preview?.url ? (
                      <a className="text-sm underline" href={preview.url} target="_blank" rel="noreferrer">
                        Open preview
                      </a>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <p className="text-muted-foreground text-sm">No pull request has been created yet.</p>
            )}
          </div>
        </section>
      ) : null}

      {intent === 'connection' ? (
        <>
          <section className="rounded-xl border p-5">
            <h3 className="font-semibold">Webhook</h3>
            <p className="text-muted-foreground text-sm">
              Subscribe to push and pull_request events. Deliveries are signature-verified and deduplicated.
            </p>
            <Label className="mt-3" htmlFor="git2-webhook">
              Payload URL
            </Label>
            <Input className="font-mono text-xs" id="git2-webhook" readOnly value={webhookUrl} />
            {webhookSecret ? (
              <Alert className="mt-3">
                <ShieldCheck />
                <AlertTitle>Copy this secret now</AlertTitle>
                <AlertDescription className="break-all font-mono text-xs">{webhookSecret}</AlertDescription>
              </Alert>
            ) : null}
            <Button className="mt-3" disabled={rotate.isPending} onClick={() => rotate.mutate()} size="sm" variant="outline">
              Rotate and reveal secret
            </Button>
          </section>

          <section className="rounded-xl border p-5">
            <div className="flex items-center gap-2">
              <Settings2 className="size-5" />
              <h3 className="font-semibold">Connection configuration</h3>
            </div>
            <p className="text-muted-foreground text-sm">
              Changing repository topology resets the common-base cache and safely establishes a new baseline. Leave the credential blank to keep the
              encrypted token.
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="git2-update-repo">Repository</Label>
                <Input id="git2-update-repo" onChange={(e) => setRepository(e.target.value)} value={repository} />
              </div>
              <div>
                <Label htmlFor="git2-update-token">Rotate token (optional)</Label>
                <Input autoComplete="off" id="git2-update-token" onChange={(e) => setToken(e.target.value)} type="password" value={token} />
              </div>
              <div>
                <Label htmlFor="git2-update-base">Base branch</Label>
                <Input id="git2-update-base" onChange={(e) => setBaseBranch(e.target.value)} value={baseBranch} />
              </div>
              <div>
                <Label htmlFor="git2-update-head">Dedicated Nibleaf branch</Label>
                <Input id="git2-update-head" onChange={(e) => setHeadBranch(e.target.value)} value={headBranch} />
              </div>
              <div>
                <Label htmlFor="git2-update-path">Content path</Label>
                <Input id="git2-update-path" onChange={(e) => setContentPath(e.target.value)} value={contentPath} />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap justify-between gap-2">
              <Button
                disabled={disconnect.isPending}
                onClick={() => {
                  if (window.confirm('Disconnect GitHub and remove encrypted credentials and sync history?')) disconnect.mutate();
                }}
                variant="destructive"
              >
                Disconnect
              </Button>
              <Button disabled={connect.isPending} onClick={() => connect.mutate()} variant="outline">
                {connect.isPending ? 'Saving…' : 'Save connection'}
              </Button>
            </div>
          </section>
        </>
      ) : null}

      {intent === 'overview' || intent === 'sync' ? (
        <section className="rounded-xl border p-5">
          <h3 className="font-semibold">Recent operations</h3>
          <div className="mt-3 space-y-2">
            {connection.operations.map((item) => (
              <div className="rounded-lg border p-3" key={item.id}>
                <div className="flex items-center gap-2">
                  <Badge variant={statusTone(item.status)}>{item.status}</Badge>
                  <span className="text-sm">
                    {item.kind} {item.commitMessage}
                  </span>
                  <span className="ms-auto text-muted-foreground text-xs">{new Date(item.createdAt).toLocaleString()}</span>
                </div>
                {item.changedFiles?.length ? (
                  <ul className="mt-2 text-muted-foreground text-xs">
                    {item.changedFiles.map((file) => (
                      <li key={file.path}>
                        {file.status}: <code>{file.path}</code>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {item.error ? <p className="mt-2 text-destructive text-xs">{item.error}</p> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
