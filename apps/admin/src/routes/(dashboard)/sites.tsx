import { Badge } from '@nibleaf/design-system/components/ui/badge';
import { Button } from '@nibleaf/design-system/components/ui/button';
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
import { createFileRoute } from '@tanstack/react-router';
import { ExternalLink, Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useInviteOrganization, useTakedownSite } from '@/hooks/api/mutations';
import { type AdminSite, useAdminSites } from '@/hooks/api/queries';
import { fmtDate } from '@/lib/format';
import { APP_URL } from '@/lib/links';

export const Route = createFileRoute('/(dashboard)/sites')({
  component: SitesPage,
});

/** Matches the server's `z.string().max(500)` on the takedown reason. */
const TAKEDOWN_REASON_MAX = 500;

function InviteOrganizationDialog() {
  const [open, setOpen] = useState(false);
  const invite = useInviteOrganization();
  const form = useForm({
    defaultValues: { organizationName: '', siteName: '', ownerEmail: '', siteSlug: '', description: '' },
    onSubmit: async ({ value }) => {
      await invite.mutateAsync({
        organizationName: value.organizationName.trim(),
        siteName: value.siteName.trim(),
        ownerEmail: value.ownerEmail.trim().toLowerCase(),
        ...(value.siteSlug.trim() ? { siteSlug: value.siteSlug.trim().toLowerCase() } : {}),
        ...(value.description.trim() ? { description: value.description.trim() } : {}),
      });
      setOpen(false);
      form.reset();
    },
  });

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" /> Invite organization
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Invite a new organization</DialogTitle>
          <DialogDescription>Create its first documentation site and email the owner a seven-day acceptance link.</DialogDescription>
        </DialogHeader>
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
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button disabled={invite.isPending} type="submit">
              {invite.isPending ? 'Creating…' : 'Create and send invite'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SitesPage() {
  const { data, isPending } = useAdminSites();
  const takedown = useTakedownSite();
  const confirm = useConfirm();
  const prompt = usePrompt();

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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-2xl tracking-tight">Sites</h1>
          <p className="mt-1 text-muted-foreground text-sm">Every documentation site across all workspaces on this instance.</p>
        </div>
        <InviteOrganizationDialog />
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Workspace</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Pages</TableHead>
              <TableHead>Deploys</TableHead>
              <TableHead>Created</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableRow>
                <TableCell className="py-8 text-center text-muted-foreground" colSpan={8}>
                  Loading…
                </TableCell>
              </TableRow>
            ) : (
              data?.map((site) => (
                <TableRow key={site.id}>
                  <TableCell className="font-medium">{site.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <span>{site.owner}</span>
                      {site.ownerStatus === 'invited' ? <Badge variant="outline">Invited</Badge> : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{site.org}</TableCell>
                  <TableCell>
                    {site.takedownAt ? (
                      <Badge title={site.takedownReason ?? undefined} variant="destructive">
                        Taken down {fmtDate(site.takedownAt)}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Live</Badge>
                    )}
                  </TableCell>
                  <TableCell>{site.pages}</TableCell>
                  <TableCell>{site.deployments}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(site.createdAt)}</TableCell>
                  <TableCell className="text-end">
                    <div className="flex items-center justify-end gap-2">
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
                        render={
                          // biome-ignore lint/a11y/useAnchorContent: content merged via Base UI render prop
                          <a aria-label="Open live site" href={`${APP_URL}/sites/${site.id}`} rel="noreferrer" target="_blank" />
                        }
                        size="icon-sm"
                        variant="ghost"
                      >
                        <ExternalLink className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
