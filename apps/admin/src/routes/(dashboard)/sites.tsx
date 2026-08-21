import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@nibleaf/design-system/components/ui/card';
import { useConfirm, usePrompt } from '@nibleaf/design-system/components/ui/confirm';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@nibleaf/design-system/components/ui/dialog';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nibleaf/design-system/components/ui/table';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { useForm } from '@tanstack/react-form';
import { createFileRoute, Link, Outlet, useRouterState } from '@tanstack/react-router';
import { ChevronRight, Copy, ExternalLink, Mail, Plus, Search } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DataEmpty, DataError } from '@/components/data-state';
import { StatusBadge } from '@/components/status-badge';
import { useInviteOrganization, useTakedownSite } from '@/hooks/api/mutations';
import { type AdminSite, useAdminSites } from '@/hooks/api/queries';
import { fmtRelative } from '@/lib/format';
import { APP_URL } from '@/lib/links';

export const Route = createFileRoute('/(dashboard)/sites')({
  component: SitesRoute,
});

/** Matches the server's `z.string().max(500)` on the takedown reason. */
const TAKEDOWN_REASON_MAX = 500;

function SitesRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return pathname === '/sites' ? <SitesPage /> : <Outlet />;
}

function InviteOrganizationDialog() {
  const [open, setOpen] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const deliveryRef = useRef<'email' | 'link'>('email');
  const invite = useInviteOrganization();
  const form = useForm({
    defaultValues: { organizationName: '', siteName: '', ownerEmail: '', siteSlug: '', description: '' },
    onSubmit: async ({ value }) => {
      const result = await invite.mutateAsync({
        organizationName: value.organizationName.trim(),
        siteName: value.siteName.trim(),
        ownerEmail: value.ownerEmail.trim().toLowerCase(),
        delivery: deliveryRef.current,
        ...(value.siteSlug.trim() ? { siteSlug: value.siteSlug.trim().toLowerCase() } : {}),
        ...(value.description.trim() ? { description: value.description.trim() } : {}),
      });
      if (deliveryRef.current === 'link') {
        setGeneratedLink(result.invitationUrl);
        try {
          await navigator.clipboard.writeText(result.invitationUrl);
          toast.success('Invitation link copied');
        } catch {
          toast.info('Invitation created — use Copy link below');
        }
      } else {
        setOpen(false);
        form.reset();
      }
    },
  });

  const closeDialog = () => {
    setOpen(false);
    setGeneratedLink(null);
    form.reset();
  };

  const copyGeneratedLink = async () => {
    if (!generatedLink) {
      return;
    }
    try {
      await navigator.clipboard.writeText(generatedLink);
      toast.success('Invitation link copied');
    } catch {
      toast.error('Could not access the clipboard. Select and copy the link manually.');
    }
  };

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setGeneratedLink(null);
          form.reset();
        }
      }}
      open={open}
    >
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" /> Invite organization
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite a new organization</DialogTitle>
          <DialogDescription>
            {generatedLink
              ? 'The organization is ready. Copy its seven-day owner invitation link.'
              : 'Create its first documentation site, then send the owner an email or copy their seven-day invitation link.'}
          </DialogDescription>
        </DialogHeader>
        {generatedLink ? (
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="generated-invitation-link">Owner invitation link</Label>
              <Input id="generated-invitation-link" onFocus={(event) => event.currentTarget.select()} readOnly value={generatedLink} />
            </div>
            <DialogFooter>
              <Button onClick={closeDialog} type="button" variant="outline">
                Done
              </Button>
              <Button onClick={copyGeneratedLink} type="button">
                <Copy className="size-4" /> Copy link
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              form.handleSubmit();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="organizationName">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label htmlFor="organization-name">Organization name</Label>
                    <Input
                      id="organization-name"
                      maxLength={100}
                      onChange={(event) => field.handleChange(event.target.value)}
                      placeholder="Acme"
                      required
                      value={field.state.value}
                    />
                  </div>
                )}
              </form.Field>
              <form.Field name="ownerEmail">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label htmlFor="owner-email">Owner email</Label>
                    <Input
                      id="owner-email"
                      onChange={(event) => field.handleChange(event.target.value)}
                      placeholder="owner@acme.com"
                      required
                      type="email"
                      value={field.state.value}
                    />
                  </div>
                )}
              </form.Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="siteName">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label htmlFor="site-name">Site name</Label>
                    <Input
                      id="site-name"
                      maxLength={100}
                      onChange={(event) => field.handleChange(event.target.value)}
                      placeholder="Acme Documentation"
                      required
                      value={field.state.value}
                    />
                  </div>
                )}
              </form.Field>
              <form.Field name="siteSlug">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label htmlFor="site-slug">Deployment slug</Label>
                    <Input
                      id="site-slug"
                      maxLength={63}
                      onChange={(event) => field.handleChange(event.target.value.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase())}
                      placeholder="acme-docs"
                      value={field.state.value}
                    />
                  </div>
                )}
              </form.Field>
            </div>
            <form.Field name="description">
              {(field) => (
                <div className="grid gap-1.5">
                  <Label htmlFor="site-description">
                    Description <span className="font-normal text-muted-foreground">(optional)</span>
                  </Label>
                  <Textarea
                    id="site-description"
                    maxLength={500}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder="What this documentation site is for"
                    rows={3}
                    value={field.state.value}
                  />
                </div>
              )}
            </form.Field>
            <DialogFooter className="sm:justify-between">
              <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button
                  disabled={invite.isPending}
                  onClick={() => {
                    deliveryRef.current = 'link';
                  }}
                  type="submit"
                  variant="secondary"
                >
                  <Copy className="size-4" /> {invite.isPending ? 'Creating…' : 'Create & copy link'}
                </Button>
                <Button
                  disabled={invite.isPending}
                  onClick={() => {
                    deliveryRef.current = 'email';
                  }}
                  type="submit"
                >
                  <Mail className="size-4" /> {invite.isPending ? 'Creating…' : 'Create & send email'}
                </Button>
              </div>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function SitesPage() {
  const query = useAdminSites();
  const takedown = useTakedownSite();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'healthy' | 'attention' | 'unpublished' | 'taken-down'>('all');

  const sites = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (query.data ?? []).filter((site) => {
      const matchesSearch =
        !needle ||
        site.name.toLowerCase().includes(needle) ||
        site.owner.toLowerCase().includes(needle) ||
        site.org.toLowerCase().includes(needle) ||
        site.slug.toLowerCase().includes(needle);
      const matchesFilter =
        filter === 'all' ||
        (filter === 'healthy' && !site.takedownAt && site.domainIssues === 0 && site.latestDeployment?.status === 'READY') ||
        (filter === 'attention' && (site.domainIssues > 0 || site.latestDeployment?.status === 'FAILED' || site.ownerStatus === 'missing')) ||
        (filter === 'unpublished' && !site.latestDeployment) ||
        (filter === 'taken-down' && Boolean(site.takedownAt));
      return matchesSearch && matchesFilter;
    });
  }, [filter, query.data, search]);

  const copyOwnerInvitation = async (site: AdminSite) => {
    if (!site.ownerInvitationId) {
      return;
    }
    try {
      await navigator.clipboard.writeText(`${APP_URL}/accept-invite/${site.ownerInvitationId}`);
      toast.success('Invitation link copied');
    } catch {
      toast.error('Could not copy the invitation link');
    }
  };

  const onTakedown = async (site: AdminSite) => {
    // The server caps the reason at 500 chars (strict); usePrompt has no length
    // limit, so validate here and re-open with the text preserved rather than
    // losing a long paste to a 400.
    let initialValue = '';
    let done = false;
    while (!done) {
      const reason = await prompt({
        title: `Take down "${site.name}"?`,
        description:
          'The published site stops being served and the owner cannot publish until it is restored. The reason is stored for the audit trail.',
        label: 'Reason',
        placeholder: 'e.g. DMCA notice, spam, phishing content',
        confirmLabel: 'Take down',
        initialValue,
      });
      if (!reason) {
        return;
      }
      if (reason.length > TAKEDOWN_REASON_MAX) {
        toast.error(`Reason must be ${TAKEDOWN_REASON_MAX} characters or fewer (currently ${reason.length}).`);
        initialValue = reason;
        continue;
      }
      takedown.mutate({ id: site.id, takedown: true, reason });
      done = true;
    }
  };

  const onRestore = async (site: AdminSite) => {
    const ok = await confirm({
      title: `Restore "${site.name}"?`,
      description: 'The site is served and publishable again.',
      confirmLabel: 'Restore site',
    });
    if (ok) {
      takedown.mutate({ id: site.id, takedown: false });
    }
  };

  if (query.isError) return <DataError retry={() => void query.refetch()} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">Sites & workspaces</h1>
          <p className="mt-1 text-muted-foreground text-sm">Publishing, domains, access, ownership, plan metadata, and usage across the instance.</p>
        </div>
        <InviteOrganizationDialog />
      </div>

      <div className="grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <label className="relative" htmlFor="site-search">
          <span className="sr-only">Search sites</span>
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="ps-9"
            id="site-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search site, workspace, owner, or slug"
            value={search}
          />
        </label>
        <label htmlFor="site-filter">
          <span className="sr-only">Filter sites</span>
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            id="site-filter"
            onChange={(event) => setFilter(event.target.value as typeof filter)}
            value={filter}
          >
            <option value="all">All sites</option>
            <option value="healthy">Healthy</option>
            <option value="attention">Needs attention</option>
            <option value="unpublished">Not published</option>
            <option value="taken-down">Taken down</option>
          </select>
        </label>
      </div>

      {query.isPending ? (
        <div className="rounded-xl border bg-card py-12 text-center text-muted-foreground text-sm" role="status">
          Loading sites…
        </div>
      ) : sites.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <DataEmpty title="No sites match" description="Clear the search or choose another operational filter." />
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
            <Table className="min-w-[1080px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>Publish</TableHead>
                  <TableHead>Domains</TableHead>
                  <TableHead>Usage</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sites.map((site: AdminSite) => (
                  <TableRow key={site.id}>
                    <TableCell>
                      <Link className="font-medium hover:underline" params={{ siteId: site.id }} to="/sites/$siteId">
                        {site.name}
                      </Link>
                      <p className="font-mono text-muted-foreground text-xs">{site.slug}</p>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <span>{site.owner}</span>
                        {site.ownerStatus === 'invited' ? <Badge variant="outline">Invited</Badge> : null}
                        {site.ownerStatus === 'missing' ? <Badge variant="destructive">Missing owner</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="text-muted-foreground">{site.org}</p>
                      <p className="text-muted-foreground text-xs">
                        {site.plan} plan · {site.members} member{site.members === 1 ? '' : 's'}
                      </p>
                    </TableCell>
                    <TableCell>
                      {site.takedownAt ? (
                        <StatusBadge label="taken down" value="taken-down" />
                      ) : site.latestDeployment ? (
                        <div className="space-y-1">
                          <StatusBadge value={site.latestDeployment.status} />
                          <p className="text-muted-foreground text-xs">
                            v{site.latestDeployment.version} · {fmtRelative(site.latestDeployment.at)}
                          </p>
                        </div>
                      ) : (
                        <Badge variant="outline">not published</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <p>{site.domains}</p>
                      {site.domainIssues ? (
                        <p className="text-destructive text-xs">
                          {site.domainIssues} issue{site.domainIssues === 1 ? '' : 's'}
                        </p>
                      ) : (
                        <p className="text-muted-foreground text-xs">No errors</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <p>
                        {site.pages} page{site.pages === 1 ? '' : 's'} · {site.languages} lang.
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {site.deployments} deployment{site.deployments === 1 ? '' : 's'} · {site.accessMode.toLowerCase()}
                      </p>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{fmtRelative(site.updatedAt)}</TableCell>
                    <TableCell className="text-end">
                      <div className="flex items-center justify-end gap-2">
                        {site.ownerInvitationId ? (
                          <Button onClick={() => copyOwnerInvitation(site)} size="sm" variant="outline">
                            <Copy className="size-4" /> Copy invite
                          </Button>
                        ) : null}
                        <Button
                          disabled={takedown.isPending && takedown.variables?.id === site.id}
                          onClick={() => (site.takedownAt ? onRestore(site) : onTakedown(site))}
                          size="sm"
                          variant={site.takedownAt ? 'outline' : 'destructive'}
                        >
                          {site.takedownAt ? 'Restore' : 'Take down'}
                        </Button>
                        <Button
                          nativeButton={false}
                          render={<Link aria-label={`View ${site.name} details`} params={{ siteId: site.id }} to="/sites/$siteId" />}
                          size="icon-sm"
                          variant="ghost"
                        >
                          <ChevronRight className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="grid gap-3 md:hidden">
            {sites.map((site) => (
              <Card key={site.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-start justify-between gap-3 text-base">
                    <span className="min-w-0">
                      <span className="block truncate">{site.name}</span>
                      <span className="block truncate font-normal text-muted-foreground text-xs">
                        {site.org} · {site.plan} plan
                      </span>
                    </span>
                    <Button
                      nativeButton={false}
                      render={<Link aria-label={`View ${site.name}`} params={{ siteId: site.id }} to="/sites/$siteId" />}
                      size="icon-sm"
                      variant="ghost"
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {site.takedownAt ? (
                      <StatusBadge label="taken down" value="taken-down" />
                    ) : site.latestDeployment ? (
                      <StatusBadge value={site.latestDeployment.status} />
                    ) : (
                      <Badge variant="outline">not published</Badge>
                    )}
                    {site.domainIssues ? (
                      <Badge variant="destructive">
                        {site.domainIssues} domain issue{site.domainIssues === 1 ? '' : 's'}
                      </Badge>
                    ) : null}
                    <Badge variant="outline">{site.accessMode.toLowerCase()}</Badge>
                  </div>
                  <dl className="grid grid-cols-3 gap-3 text-xs">
                    <div>
                      <dt className="text-muted-foreground">Pages</dt>
                      <dd className="font-medium">{site.pages}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Members</dt>
                      <dd className="font-medium">{site.members}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Updated</dt>
                      <dd className="font-medium">{fmtRelative(site.updatedAt)}</dd>
                    </div>
                  </dl>
                  <div className="flex gap-2">
                    {site.ownerInvitationId ? (
                      <Button onClick={() => copyOwnerInvitation(site)} size="sm" variant="outline">
                        <Copy className="size-4" /> Copy invite
                      </Button>
                    ) : null}
                    <Button
                      nativeButton={false}
                      render={
                        // biome-ignore lint/a11y/useAnchorContent: accessible content is merged from the Button children
                        <a aria-label={`Open ${site.name} customer view`} href={`${APP_URL}/sites/${site.id}`} rel="noreferrer" target="_blank" />
                      }
                      size="sm"
                      variant="outline"
                    >
                      <ExternalLink className="size-4" /> Customer view
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
      {!query.isPending ? (
        <p className="text-muted-foreground text-xs" aria-live="polite">
          Showing {sites.length} of {query.data?.length ?? 0} sites
        </p>
      ) : null}
    </div>
  );
}
