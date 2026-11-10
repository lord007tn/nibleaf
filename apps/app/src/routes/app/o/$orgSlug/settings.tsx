import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm, usePrompt } from '@nibleaf/design-system/components/ui/confirm';
import { FieldError } from '@nibleaf/design-system/components/ui/form-field';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Label } from '@nibleaf/design-system/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { Switch } from '@nibleaf/design-system/components/ui/switch';
import { useT } from '@nibleaf/i18n/react';
import { useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Building2, Mail, TriangleAlert } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/app/page-header';
import { isOrgAdmin, useCurrentOrganization } from '@/components/organization/organization-context';
import {
  type OrganizationDetail,
  type SwitcherData,
  switcherQueryOptions,
  useDeleteOrganization,
  useLeaveOrganization,
  useOrganizationMembers,
  useOrganizationProjects,
  useTransferOrganizationOwnership,
  useUpdateOrganization,
} from '@/hooks/api';
import { ApiResponseError } from '@/hooks/api/client-helpers';
import { useFormatters } from '@/lib/format';

export const Route = createFileRoute('/app/o/$orgSlug/settings')({ component: OrganizationSettingsPage });

const HANDLE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Org Settings (§5.1): General, Invitations, Danger zone. Members see only "Leave organization". */
function OrganizationSettingsPage() {
  const organization = useCurrentOrganization();
  const t = useT();
  const admin = isOrgAdmin(organization);
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <PageHeader description={t('organization.settings.subtitle', { org: organization.name })} title={t('nav.settings')} />
      {admin ? <GeneralSection organization={organization} /> : null}
      {admin ? <InvitationsSection organization={organization} /> : null}
      <DangerZone organization={organization} />
    </div>
  );
}

function Section({ icon, title, description, children }: { icon: ReactNode; title: string; description?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex items-start gap-3 border-border border-b px-5 py-4">
        <span aria-hidden className="mt-0.5 text-muted-foreground [&_svg]:size-4">
          {icon}
        </span>
        <div>
          <h2 className="font-semibold">{title}</h2>
          {description ? <p className="mt-0.5 text-muted-foreground text-sm">{description}</p> : null}
        </div>
      </div>
      <div className="flex flex-col gap-5 p-5">{children}</div>
    </section>
  );
}

function GeneralSection({ organization }: { organization: OrganizationDetail }) {
  const t = useT();
  const navigate = useNavigate();
  const update = useUpdateOrganization(organization.id);
  const [name, setName] = useState(organization.name);
  const [slug, setSlug] = useState(organization.slug);
  const [logo, setLogo] = useState(organization.logo ?? '');
  const ids = { name: useId(), slug: useId(), logo: useId(), slugHint: useId() };
  const slugError =
    slug !== organization.slug && (slug.length < 3 || slug.length > 48 || !HANDLE_PATTERN.test(slug))
      ? t('organization.settings.handleInvalid')
      : null;
  const logoError = logo && !/^https:\/\/\S+$/.test(logo) ? t('organization.settings.logoInvalid') : null;
  const dirty = name.trim() !== organization.name || slug !== organization.slug || (logo || null) !== organization.logo;

  const save = () => {
    const body = {
      ...(name.trim() !== organization.name ? { name: name.trim() } : {}),
      ...(slug !== organization.slug ? { slug } : {}),
      ...((logo || null) !== organization.logo ? { logo: logo || null } : {}),
    };
    update.mutate(body, {
      onSuccess: (saved) => {
        toast.success(t('organization.settings.saved'));
        // A new handle: move to it. The old one stays as an alias that redirects here.
        if (saved.slug !== organization.slug) void navigate({ to: '/app/o/$orgSlug/settings', params: { orgSlug: saved.slug }, replace: true });
      },
      onError: (error) =>
        toast.error(
          error instanceof ApiResponseError && error.status === 409 ? t('organization.settings.handleTaken') : t('organization.settings.saveError'),
        ),
    });
  };

  return (
    <Section description={t('organization.settings.generalDescription')} icon={<Building2 />} title={t('organization.settings.general')}>
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault();
          if (dirty && name.trim() && !slugError && !logoError) save();
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.name}>{t('organization.settings.name')}</Label>
          <Input dir="auto" id={ids.name} maxLength={100} onChange={(event) => setName(event.target.value)} value={name} />
          {!name.trim() ? <FieldError errors={[t('organization.settings.nameRequired')]} /> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.slug}>{t('organization.settings.handle')}</Label>
          <div className="flex min-w-0 items-center gap-2" dir="ltr">
            <span className="shrink-0 font-mono text-muted-foreground text-sm">/app/o/</span>
            <Input
              aria-describedby={ids.slugHint}
              aria-invalid={Boolean(slugError)}
              className="font-mono"
              id={ids.slug}
              maxLength={48}
              onChange={(event) => setSlug(event.target.value.toLowerCase())}
              value={slug}
            />
          </div>
          <p className="text-muted-foreground text-xs" id={ids.slugHint}>
            {t('organization.settings.handleAlias')}
          </p>
          {slugError ? <FieldError errors={[slugError]} /> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={ids.logo}>{t('organization.settings.logo')}</Label>
          <Input
            dir="ltr"
            id={ids.logo}
            inputMode="url"
            onChange={(event) => setLogo(event.target.value.trim())}
            placeholder="https://"
            value={logo}
          />
          <p className="text-muted-foreground text-xs">{t('organization.settings.logoHint')}</p>
          {logoError ? <FieldError errors={[logoError]} /> : null}
        </div>
        <div>
          <Button disabled={!dirty || !name.trim() || Boolean(slugError) || Boolean(logoError)} loading={update.isPending} type="submit">
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Section>
  );
}

function InvitationsSection({ organization }: { organization: OrganizationDetail }) {
  const t = useT();
  const update = useUpdateOrganization(organization.id);
  const labelId = useId();
  const descriptionId = useId();
  const checked = organization.sendInvitationEmails ?? true;
  return (
    <Section icon={<Mail />} title={t('organization.settings.invitations')}>
      <div className="flex items-center gap-4">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm" id={labelId}>
            {t('organization.settings.sendInvitationEmails')}
          </div>
          <p className="mt-0.5 text-muted-foreground text-sm" id={descriptionId}>
            {t('organization.settings.sendInvitationEmailsHint')}
          </p>
        </div>
        <Switch
          aria-describedby={descriptionId}
          aria-labelledby={labelId}
          checked={checked}
          disabled={update.isPending}
          onCheckedChange={(next) =>
            update.mutate({ sendInvitationEmails: next }, { onError: () => toast.error(t('organization.settings.saveError')) })
          }
        />
      </div>
    </Section>
  );
}

function DangerZone({ organization }: { organization: OrganizationDetail }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const owner = organization.orgRole === 'owner';
  const leave = useLeaveOrganization(organization.id);
  const remove = useDeleteOrganization(organization.id);

  // After leaving or deleting: another org if there is one, else the welcome screen (§6.8).
  const goHome = async () => {
    const switcher = await queryClient.fetchQuery({ ...switcherQueryOptions(), staleTime: 0 }).catch(() => null as SwitcherData | null);
    if (switcher?.landing) await navigate({ to: '/app/o/$orgSlug/websites', params: { orgSlug: switcher.landing.slug }, replace: true });
    else await navigate({ to: '/app/welcome', search: { reason: 'left' }, replace: true });
  };

  return (
    <Section icon={<TriangleAlert />} title={t('settings.danger.title')}>
      {owner ? (
        <>
          <TransferOwnership organization={organization} />
          <DeleteOrganization goHome={goHome} organization={organization} prompt={prompt} remove={remove} />
          <p className="text-muted-foreground text-sm">{t('organization.settings.ownerCannotLeave')}</p>
        </>
      ) : (
        <DangerRow
          action={
            <Button
              loading={leave.isPending}
              onClick={async () => {
                const ok = await confirm({
                  title: t('organization.settings.leave'),
                  description: t('organization.settings.leaveConfirm', { org: organization.name }),
                  confirmLabel: t('organization.settings.leave'),
                  destructive: true,
                });
                if (!ok) return;
                leave.mutate(undefined, {
                  onSuccess: async () => {
                    toast.success(t('organization.settings.left', { org: organization.name }));
                    await goHome();
                  },
                  onError: () => toast.error(t('organization.settings.leaveError')),
                });
              }}
              variant="outline"
            >
              {t('organization.settings.leave')}
            </Button>
          }
          description={t('organization.settings.leaveDescription')}
          title={t('organization.settings.leave')}
        />
      )}
    </Section>
  );
}

function DangerRow({ title, description, action, children }: { title: string; description: ReactNode; action: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-stretch gap-4 rounded-xl border border-destructive/30 p-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1 text-[13.5px] text-muted-foreground leading-relaxed">
        <strong className="text-foreground">{title}</strong>
        <div>{description}</div>
        {children}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>
    </div>
  );
}

/** Owner → an existing org Admin, confirmed by typing the org name (§6.9). */
function TransferOwnership({ organization }: { organization: OrganizationDetail }) {
  const t = useT();
  const prompt = usePrompt();
  const members = useOrganizationMembers(organization.id);
  const transfer = useTransferOrganizationOwnership(organization.id);
  const [target, setTarget] = useState('');
  const admins = (members.data ?? []).filter((member) => member.orgRole === 'admin');
  const options = admins.map((member) => ({ value: member.id, label: `${member.user.name || member.user.email} · ${member.user.email}` }));
  const selected = admins.find((member) => member.id === target);
  const hintId = useId();
  return (
    <DangerRow
      action={
        <>
          <Select disabled={admins.length === 0} items={options} onValueChange={(value) => setTarget(value ?? '')} value={target}>
            <SelectTrigger aria-describedby={hintId} aria-label={t('organization.settings.transfer')} className="w-full min-w-0 sm:w-56">
              <SelectValue placeholder={t('settings.danger.transfer.placeholder')} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <span dir="auto">{option.label}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            disabled={!selected}
            loading={transfer.isPending}
            onClick={async () => {
              if (!selected) return;
              const typed = await prompt({
                title: t('organization.settings.transfer'),
                description: t('organization.settings.transferConfirm', { name: selected.user.name || selected.user.email, org: organization.name }),
                label: t('organization.settings.typeName', { org: organization.name }),
                placeholder: organization.name,
                destructive: true,
                validate: (value) => (value === organization.name ? undefined : t('organization.settings.nameMismatch')),
                confirmLabel: t('settings.danger.transfer.button'),
              });
              if (typed !== organization.name) return;
              transfer.mutate(selected.id, {
                onSuccess: () => {
                  toast.success(t('settings.danger.transfer.toast.transferred'));
                  setTarget('');
                },
                onError: () => toast.error(t('settings.danger.transfer.toast.error')),
              });
            }}
            variant="outline"
          >
            {t('settings.danger.transfer.button')}
          </Button>
        </>
      }
      description={t('organization.settings.transferDescription')}
      title={t('organization.settings.transfer')}
    >
      <p className="mt-1 text-xs" id={hintId}>
        {!members.isPending && admins.length === 0 ? t('organization.settings.transferNoAdmins') : null}
      </p>
    </DangerRow>
  );
}

/** Lists what will be erased, then asks for the org name (§6.12). */
function DeleteOrganization({
  organization,
  prompt,
  remove,
  goHome,
}: {
  organization: OrganizationDetail;
  prompt: ReturnType<typeof usePrompt>;
  remove: ReturnType<typeof useDeleteOrganization>;
  goHome: () => Promise<void>;
}) {
  const t = useT();
  const { count } = useFormatters();
  const projects = useOrganizationProjects(organization.id);
  const websites = projects.data ?? [];
  const pages = websites.reduce((sum, site) => sum + (site._count?.pages ?? 0), 0);
  const summary =
    websites.length === 0
      ? t('organization.settings.deleteEmpty')
      : t('organization.settings.deleteSummary', {
          websites: t('organization.members.websites', count(websites.length)),
          pages: t('dashboard.pages', count(pages)),
          names: websites.map((site) => site.name).join(', '),
        });
  return (
    <DangerRow
      action={
        <Button
          disabled={projects.isPending}
          loading={remove.isPending}
          onClick={async () => {
            const typed = await prompt({
              title: t('organization.settings.delete'),
              description: summary,
              label: t('organization.settings.typeName', { org: organization.name }),
              placeholder: organization.name,
              destructive: true,
              validate: (value) => (value === organization.name ? undefined : t('organization.settings.nameMismatch')),
              confirmLabel: t('organization.settings.delete'),
            });
            if (typed !== organization.name) return;
            remove.mutate(typed, {
              onSuccess: async () => {
                toast.success(t('organization.settings.deleted', { org: organization.name }));
                await goHome();
              },
              onError: () => toast.error(t('organization.settings.deleteError')),
            });
          }}
          variant="destructive"
        >
          {t('organization.settings.delete')}
        </Button>
      }
      description={t('organization.settings.deleteDescription')}
      title={t('organization.settings.delete')}
    >
      {websites.length > 0 ? (
        <p className="mt-1 text-xs" data-slot="delete-summary">
          {summary}
        </p>
      ) : null}
    </DangerRow>
  );
}
