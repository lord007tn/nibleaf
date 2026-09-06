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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@nibleaf/design-system/components/ui/table';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { useT } from '@nibleaf/i18n/react';
import { useForm } from '@tanstack/react-form';
import { createFileRoute, Link, Outlet, useRouterState } from '@tanstack/react-router';
import { ChevronRight, Copy, ExternalLink, Mail, Plus, Search } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DataEmpty, DataError } from '@/components/data-state';
import { StatusBadge } from '@/components/status-badge';
import { useInviteOrganization, useTakedownSite } from '@/hooks/api/mutations';
import { type AdminSite, useAdminSites } from '@/hooks/api/queries';
import { useFormatters } from '@/lib/format';
import { APP_URL } from '@/lib/links';

export const Route = createFileRoute('/(dashboard)/sites')({
  component: SitesRoute,
});

/** Matches the server's `z.string().max(500)` on the takedown reason. */
const TAKEDOWN_REASON_MAX = 500;

type SiteFilter = 'all' | 'healthy' | 'attention' | 'unpublished' | 'taken-down';

function SitesRoute() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return pathname === '/sites' ? <SitesPage /> : <Outlet />;
}

function InviteOrganizationDialog() {
  const t = useT();
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
          toast.success(t('admin.sites.invitationCopied'));
        } catch {
          toast.info(t('admin.sites.invitationCreated'));
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
      toast.success(t('admin.sites.invitationCopied'));
    } catch {
      toast.error(t('admin.sites.clipboardError'));
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
        <Plus className="size-4" /> {t('admin.sites.inviteOrganization')}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('admin.sites.inviteTitle')}</DialogTitle>
          <DialogDescription>{generatedLink ? t('admin.sites.inviteReady') : t('admin.sites.inviteBody')}</DialogDescription>
        </DialogHeader>
        {generatedLink ? (
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="generated-invitation-link">{t('admin.sites.ownerInvitation')}</Label>
              <Input id="generated-invitation-link" onFocus={(event) => event.currentTarget.select()} readOnly value={generatedLink} />
            </div>
            <DialogFooter>
              <Button onClick={closeDialog} type="button" variant="outline">
                {t('admin.common.done')}
              </Button>
              <Button onClick={copyGeneratedLink} type="button">
                <Copy className="size-4" /> {t('admin.sites.copyLink')}
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
                    <Label htmlFor="organization-name">{t('admin.sites.organizationName')}</Label>
                    <Input
                      id="organization-name"
                      maxLength={100}
                      onChange={(event) => field.handleChange(event.target.value)}
                      placeholder={t('admin.sites.organizationPlaceholder')}
                      required
                      value={field.state.value}
                    />
                  </div>
                )}
              </form.Field>
              <form.Field name="ownerEmail">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label htmlFor="owner-email">{t('admin.sites.ownerEmail')}</Label>
                    <Input
                      id="owner-email"
                      onChange={(event) => field.handleChange(event.target.value)}
                      placeholder={t('admin.sites.ownerEmailPlaceholder')}
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
                    <Label htmlFor="site-name">{t('admin.sites.siteName')}</Label>
                    <Input
                      id="site-name"
                      maxLength={100}
                      onChange={(event) => field.handleChange(event.target.value)}
                      placeholder={t('admin.sites.siteNamePlaceholder')}
                      required
                      value={field.state.value}
                    />
                  </div>
                )}
              </form.Field>
              <form.Field name="siteSlug">
                {(field) => (
                  <div className="grid gap-1.5">
                    <Label htmlFor="site-slug">{t('admin.sites.deploymentSlug')}</Label>
                    <Input
                      id="site-slug"
                      maxLength={63}
                      onChange={(event) => field.handleChange(event.target.value.replace(/[^a-zA-Z0-9-]/g, '').toLowerCase())}
                      placeholder={t('admin.sites.slugPlaceholder')}
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
                    {t('admin.sites.description')} <span className="font-normal text-muted-foreground">{t('admin.common.optional')}</span>
                  </Label>
                  <Textarea
                    id="site-description"
                    maxLength={500}
                    onChange={(event) => field.handleChange(event.target.value)}
                    placeholder={t('admin.sites.descriptionPlaceholder')}
                    rows={3}
                    value={field.state.value}
                  />
                </div>
              )}
            </form.Field>
            <DialogFooter className="sm:justify-between">
              <DialogClose render={<Button type="button" variant="outline" />}>{t('common.cancel')}</DialogClose>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button
                  disabled={invite.isPending}
                  onClick={() => {
                    deliveryRef.current = 'link';
                  }}
                  type="submit"
                  variant="secondary"
                >
                  <Copy className="size-4" /> {invite.isPending ? t('admin.sites.creating') : t('admin.sites.createCopy')}
                </Button>
                <Button
                  disabled={invite.isPending}
                  onClick={() => {
                    deliveryRef.current = 'email';
                  }}
                  type="submit"
                >
                  <Mail className="size-4" /> {invite.isPending ? t('admin.sites.creating') : t('admin.sites.createEmail')}
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
  const t = useT();
  const format = useFormatters();
  const query = useAdminSites();
  const takedown = useTakedownSite();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<SiteFilter>('all');
  const filterOptions = [
    { value: 'all', label: t('admin.sites.all') },
    { value: 'healthy', label: t('admin.status.healthy') },
    { value: 'attention', label: t('admin.status.attention') },
    { value: 'unpublished', label: t('admin.status.unpublished') },
    { value: 'taken-down', label: t('admin.status.takenDown') },
  ] satisfies { value: SiteFilter; label: string }[];

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
      toast.success(t('admin.sites.invitationCopied'));
    } catch {
      toast.error(t('admin.sites.copyError'));
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
        title: t('admin.sites.takedownTitle', { site: site.name }),
        description: t('admin.sites.takedownBody'),
        label: t('admin.sites.reason'),
        placeholder: t('admin.sites.reasonPlaceholder'),
        confirmLabel: t('admin.sites.takedown'),
        initialValue,
      });
      if (!reason) {
        return;
      }
      if (reason.length > TAKEDOWN_REASON_MAX) {
        toast.error(t('admin.sites.reasonLength', { max: format.number(TAKEDOWN_REASON_MAX), current: format.number(reason.length) }));
        initialValue = reason;
        continue;
      }
      takedown.mutate({ id: site.id, takedown: true, reason });
      done = true;
    }
  };

  const onRestore = async (site: AdminSite) => {
    const ok = await confirm({
      title: t('admin.sites.restoreTitle', { site: site.name }),
      description: t('admin.sites.restoreBody'),
      confirmLabel: t('admin.sites.restoreSite'),
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
          <h1 className="font-semibold text-2xl tracking-tight">{t('admin.sites.title')}</h1>
          <p className="mt-1 text-muted-foreground text-sm">{t('admin.sites.subtitle')}</p>
        </div>
        <InviteOrganizationDialog />
      </div>

      <div className="grid gap-3 rounded-xl border bg-card p-3 sm:grid-cols-[minmax(0,1fr)_12rem]">
        <label className="relative" htmlFor="site-search">
          <span className="sr-only">{t('admin.sites.search')}</span>
          <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="ps-9"
            id="site-search"
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('admin.sites.searchPlaceholder')}
            value={search}
          />
        </label>
        <div>
          <Label className="sr-only" htmlFor="site-filter">
            {t('admin.sites.filter')}
          </Label>
          <Select items={filterOptions} onValueChange={(value) => setFilter(value ?? 'all')} value={filter}>
            <SelectTrigger className="w-full bg-background" id="site-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {filterOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {query.isPending ? (
        <div className="rounded-xl border bg-card py-12 text-center text-muted-foreground text-sm" role="status">
          {t('admin.sites.loading')}
        </div>
      ) : sites.length === 0 ? (
        <div className="rounded-xl border bg-card">
          <DataEmpty title={t('admin.sites.empty')} description={t('admin.sites.emptyBody')} />
        </div>
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
            <Table className="min-w-[1080px]">
              <TableHeader>
                <TableRow>
                  <TableHead>{t('admin.common.name')}</TableHead>
                  <TableHead>{t('admin.common.owner')}</TableHead>
                  <TableHead>{t('admin.common.workspace')}</TableHead>
                  <TableHead>{t('admin.common.publish')}</TableHead>
                  <TableHead>{t('admin.common.domains')}</TableHead>
                  <TableHead>{t('admin.common.usage')}</TableHead>
                  <TableHead>{t('admin.common.updated')}</TableHead>
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
                        {site.ownerStatus === 'invited' ? <Badge variant="outline">{t('admin.status.invited')}</Badge> : null}
                        {site.ownerStatus === 'missing' ? <Badge variant="destructive">{t('admin.status.missingOwner')}</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <p className="text-muted-foreground">{site.org}</p>
                      <p className="text-muted-foreground text-xs">
                        {t('admin.sites.workspaceSummary', { plan: site.plan, members: format.number(site.members) })}
                      </p>
                    </TableCell>
                    <TableCell>
                      {site.takedownAt ? (
                        <StatusBadge label={t('admin.status.takenDown')} value="taken-down" />
                      ) : site.latestDeployment ? (
                        <div className="space-y-1">
                          <StatusBadge value={site.latestDeployment.status} />
                          <p className="text-muted-foreground text-xs">
                            v{format.number(site.latestDeployment.version)} · {format.relative(site.latestDeployment.at)}
                          </p>
                        </div>
                      ) : (
                        <Badge variant="outline">{t('admin.status.unpublished')}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <p>{format.number(site.domains)}</p>
                      {site.domainIssues ? (
                        <p className="text-destructive text-xs">{t('admin.sites.issueCount', { count: format.number(site.domainIssues) })}</p>
                      ) : (
                        <p className="text-muted-foreground text-xs">{t('admin.sites.noErrors')}</p>
                      )}
                    </TableCell>
                    <TableCell>
                      <p>{t('admin.sites.contentSummary', { pages: format.number(site.pages), languages: format.number(site.languages) })}</p>
                      <p className="text-muted-foreground text-xs">
                        {t('admin.sites.deliverySummary', { deployments: format.number(site.deployments), access: site.accessMode.toLowerCase() })}
                      </p>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{format.relative(site.updatedAt)}</TableCell>
                    <TableCell className="text-end">
                      <div className="flex items-center justify-end gap-2">
                        {site.ownerInvitationId ? (
                          <Button onClick={() => copyOwnerInvitation(site)} size="sm" variant="outline">
                            <Copy className="size-4" /> {t('admin.sites.copyInvite')}
                          </Button>
                        ) : null}
                        <Button
                          disabled={takedown.isPending && takedown.variables?.id === site.id}
                          onClick={() => (site.takedownAt ? onRestore(site) : onTakedown(site))}
                          size="sm"
                          variant={site.takedownAt ? 'outline' : 'destructive'}
                        >
                          {site.takedownAt ? t('admin.sites.restore') : t('admin.sites.takedown')}
                        </Button>
                        <Button
                          nativeButton={false}
                          render={
                            <Link aria-label={t('admin.sites.viewDetails', { site: site.name })} params={{ siteId: site.id }} to="/sites/$siteId" />
                          }
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
                        {t('admin.sites.orgPlan', { organization: site.org, plan: site.plan })}
                      </span>
                    </span>
                    <Button
                      nativeButton={false}
                      render={<Link aria-label={t('admin.sites.view', { site: site.name })} params={{ siteId: site.id }} to="/sites/$siteId" />}
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
                      <StatusBadge label={t('admin.status.takenDown')} value="taken-down" />
                    ) : site.latestDeployment ? (
                      <StatusBadge value={site.latestDeployment.status} />
                    ) : (
                      <Badge variant="outline">{t('admin.status.unpublished')}</Badge>
                    )}
                    {site.domainIssues ? (
                      <Badge variant="destructive">{t('admin.sites.domainIssueCount', { count: format.number(site.domainIssues) })}</Badge>
                    ) : null}
                    <Badge variant="outline">{site.accessMode.toLowerCase()}</Badge>
                  </div>
                  <dl className="grid grid-cols-3 gap-3 text-xs">
                    <div>
                      <dt className="text-muted-foreground">{t('admin.common.pages')}</dt>
                      <dd className="font-medium">{format.number(site.pages)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t('admin.common.members')}</dt>
                      <dd className="font-medium">{format.number(site.members)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t('admin.common.updated')}</dt>
                      <dd className="font-medium">{format.relative(site.updatedAt)}</dd>
                    </div>
                  </dl>
                  <div className="flex gap-2">
                    {site.ownerInvitationId ? (
                      <Button onClick={() => copyOwnerInvitation(site)} size="sm" variant="outline">
                        <Copy className="size-4" /> {t('admin.sites.copyInvite')}
                      </Button>
                    ) : null}
                    <Button
                      nativeButton={false}
                      render={
                        <a
                          aria-label={t('admin.sites.openCustomerView', { site: site.name })}
                          href={`${APP_URL}/sites/${site.id}`}
                          rel="noreferrer"
                          target="_blank"
                        />
                      }
                      size="sm"
                      variant="outline"
                    >
                      <ExternalLink className="size-4" /> {t('admin.sites.customerView')}
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
          {t('admin.sites.showing', { shown: format.number(sites.length), total: format.number(query.data?.length ?? 0) })}
        </p>
      ) : null}
    </div>
  );
}
