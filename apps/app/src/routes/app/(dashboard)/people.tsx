import { Button } from '@nibleaf/design-system/components/ui/button';
import { useConfirm } from '@nibleaf/design-system/components/ui/confirm';
import { Input } from '@nibleaf/design-system/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@nibleaf/design-system/components/ui/select';
import { SkeletonListRow } from '@nibleaf/design-system/components/ui/skeleton';
import { useT } from '@nibleaf/i18n/react';
import { MemberRole } from '@nibleaf/shared/constants';
import type { AssignableMemberRole } from '@nibleaf/shared/rbac';
import { useDebouncedValue } from '@tanstack/react-pacer';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Crown, Mail, Plus, Search, Trash2, Users } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { RoleSelect } from '@/components/members/role-select';
import { QueryErrorState } from '@/components/query-error-state';
import { GradientAvatar } from '@/components/settings/section';
import { friendlyErrorMessage, type PeopleOverview, usePeople, usePeopleChanges } from '@/hooks/api';
import { peopleQueryOptions } from '@/hooks/api/query-options';
import { DEFAULT_INVITE_ROLE, roleLabelKey } from '@/lib/member-roles';
import { useSession } from '@/services/auth-client';

export const Route = createFileRoute('/app/(dashboard)/people')({
  // Start the first page with the route; a failure shows through the page's own query.
  loader: ({ context: { queryClient } }) => {
    if (typeof window !== 'undefined') void queryClient.prefetchInfiniteQuery(peopleQueryOptions()).catch(() => undefined);
  },
  component: PeoplePage,
});

type Person = PeopleOverview['people'][number];
type Site = PeopleOverview['sites'][number];

/**
 * Everyone on the sites you own or administer, and what each person can do on
 * each of those sites. This is where you give someone access to some sites and
 * not others. Every change goes through that site's own member actions.
 */
function PeoplePage() {
  const t = useT();
  const { data: session } = useSession();
  const [filter, setFilter] = useState('');
  // Searched on the server, so an account with thousands of people never loads them all.
  const [query] = useDebouncedValue(filter.trim(), { wait: 250 });
  const people = usePeople(query);
  const pages = people.data?.pages;
  // Sites, totals and invitations come with the first page; people accumulate page by page.
  const data = pages?.[0];
  const visible = useMemo(() => pages?.flatMap((page) => page.people) ?? [], [pages]);
  const siteById = useMemo(() => new Map((data?.sites ?? []).map((site) => [site.projectId, site])), [data?.sites]);
  // A new search keeps the previous results on screen until its own arrive.
  const searching = people.isPlaceholderData || filter.trim() !== query;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-semibold text-3xl tracking-tight">{t('people.title')}</h1>
        <p className="mt-1 max-w-prose text-muted-foreground text-sm">{t('people.subtitle')}</p>
      </div>

      {people.isPending ? (
        <div aria-busy="true" className="rounded-xl border border-border bg-card p-2">
          <p className="sr-only" role="status">
            {t('common.loading')}
          </p>
          <SkeletonListRow />
          <SkeletonListRow />
          <SkeletonListRow />
        </div>
      ) : people.isError && !data ? (
        <QueryErrorState onRetry={() => void people.refetch()} retrying={people.isFetching} />
      ) : !data || data.sites.length === 0 ? (
        <div className="rounded-xl border border-border border-dashed bg-card p-8 text-center">
          <Users aria-hidden className="mx-auto size-7 text-muted-foreground" />
          <p className="mt-3 font-medium">{t('people.empty.title')}</p>
          <p className="mx-auto mt-1 max-w-md text-muted-foreground text-sm">{t('people.empty.body')}</p>
          <Button className="mt-4" nativeButton={false} render={<Link to="/app/sites" />} variant="outline">
            {t('nav.sites')}
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-0 basis-full sm:max-w-sm sm:flex-1 sm:basis-auto">
              <Search aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label={t('people.filter')}
                className="ps-8"
                onChange={(event) => setFilter(event.target.value)}
                placeholder={t('people.filter')}
                type="search"
                value={filter}
              />
            </div>
            <p className="text-muted-foreground text-sm">{t('people.summary', { people: data.total, sites: data.sites.length })}</p>
          </div>

          <ul aria-busy={searching || undefined} className="flex flex-col gap-3" data-testid="people-list">
            {visible.map((person) => (
              <PersonCard isSelf={person.user.id === session?.user.id} key={person.user.id} person={person} siteById={siteById} sites={data.sites} />
            ))}
            {visible.length === 0 ? <li className="py-6 text-center text-muted-foreground text-sm">{t('people.noMatch')}</li> : null}
          </ul>
          {visible.length > 0 && data.total > visible.length ? (
            <div className="flex flex-wrap items-center justify-center gap-3">
              <p className="text-muted-foreground text-sm">{t('people.showing', { shown: visible.length, total: data.total })}</p>
              {people.hasNextPage ? (
                <Button
                  loading={people.isFetchingNextPage}
                  loadingText={t('common.loading')}
                  onClick={() => void people.fetchNextPage()}
                  variant="outline"
                >
                  {t('people.loadMore')}
                </Button>
              ) : null}
            </div>
          ) : null}
          {people.isFetchNextPageError ? <QueryErrorState onRetry={() => void people.fetchNextPage()} retrying={people.isFetchingNextPage} /> : null}

          {data.invitations.length > 0 ? (
            <PendingInvitations invitations={data.invitations} siteById={siteById} total={data.invitationsTotal} />
          ) : null}
        </>
      )}
    </div>
  );
}

function PersonCard({ person, sites, siteById, isSelf }: { person: Person; sites: Site[]; siteById: Map<string, Site>; isSelf: boolean }) {
  const t = useT();
  const confirm = useConfirm();
  const { changeRole, remove } = usePeopleChanges();
  const [adding, setAdding] = useState(false);
  const name = person.user.name || person.user.email;
  const memberOf = new Set(person.memberships.map((membership) => membership.projectId));
  const otherSites = sites.filter((site) => !memberOf.has(site.projectId));

  return (
    <li className="rounded-xl border border-border bg-card" data-testid="person">
      <div className="flex items-center gap-3 border-border border-b px-4 py-3">
        <GradientAvatar className="size-9 text-[12px]" name={person.user.name} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium text-[14px]" dir="auto">
              {name}
            </span>
            {isSelf ? <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{t('people.you')}</span> : null}
          </div>
          {person.user.name ? (
            <div className="truncate text-[12.5px] text-muted-foreground" dir="ltr">
              {person.user.email}
            </div>
          ) : null}
        </div>
      </div>
      <ul className="divide-y divide-border">
        {person.memberships.map((membership) => {
          const site = siteById.get(membership.projectId);
          if (!site) return null;
          const locked = isSelf || membership.role === MemberRole.OWNER;
          return (
            <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5" key={membership.memberId}>
              <Link
                className="min-w-0 flex-1 truncate text-[13.5px] hover:underline"
                dir="auto"
                params={{ projectId: site.projectId }}
                search={{ section: 'members' }}
                to="/app/projects/$projectId/settings"
              >
                {site.name}
              </Link>
              {locked ? (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground text-sm">
                  {membership.role === MemberRole.OWNER ? <Crown aria-hidden className="size-3.5" /> : null}
                  {t(roleLabelKey(membership.role))}
                </span>
              ) : (
                <div className="flex items-center gap-1">
                  <RoleSelect
                    ariaLabel={t('people.roleOn', { name, site: site.name })}
                    className="w-28"
                    onValueChange={(role) =>
                      changeRole.mutate(
                        { projectId: site.projectId, memberId: membership.memberId, role },
                        {
                          onSuccess: () => toast.success(t('people.toast.roleUpdated', { name, site: site.name })),
                          onError: (error) => toast.error(friendlyErrorMessage(t, error, 'settings.members.toast.roleError')),
                        },
                      )
                    }
                    size="sm"
                    value={membership.role as AssignableMemberRole}
                  />
                  <Button
                    aria-label={t('people.removeFrom', { name, site: site.name })}
                    loading={remove.isPending && remove.variables?.memberId === membership.memberId}
                    onClick={async () => {
                      const ok = await confirm({
                        title: t('people.removeFrom', { name, site: site.name }),
                        description: t('people.removeConfirm', { name, site: site.name }),
                        confirmLabel: t('settings.members.remove'),
                        destructive: true,
                      });
                      if (!ok) return;
                      remove.mutate(
                        { projectId: site.projectId, memberId: membership.memberId },
                        {
                          onSuccess: () => toast.success(t('people.toast.removed', { name, site: site.name })),
                          onError: (error) =>
                            toast.error(
                              friendlyErrorMessage(t, error, 'settings.members.toast.removeError', { 409: 'settings.members.toast.removeError' }),
                            ),
                        },
                      );
                    }}
                    size="icon-sm"
                    title={t('people.removeFrom', { name, site: site.name })}
                    variant="ghost"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {otherSites.length > 0 && !isSelf ? (
        adding ? (
          <AddToSiteForm email={person.user.email} name={name} onDone={() => setAdding(false)} sites={otherSites} />
        ) : (
          <div className="border-border border-t px-4 py-2">
            <Button onClick={() => setAdding(true)} size="sm" variant="ghost">
              <Plus className="size-4" /> {t('people.addToSite')}
            </Button>
          </div>
        )
      ) : null}
    </li>
  );
}

/** Invite someone to one more site you administer (the site's normal invitation). */
function AddToSiteForm({ email, name, sites, onDone }: { email: string; name: string; sites: Site[]; onDone: () => void }) {
  const t = useT();
  const { invite } = usePeopleChanges();
  const [chosen, setChosen] = useState(sites[0]?.projectId ?? '');
  const [role, setRole] = useState<AssignableMemberRole>(DEFAULT_INVITE_ROLE);
  const items = sites.map((site) => ({ value: site.projectId, label: site.name }));
  // If the chosen site leaves the options (they joined it meanwhile, or you no
  // longer administer it), the picker clears and asks again.
  const site = sites.find((candidate) => candidate.projectId === chosen);
  const projectId = site?.projectId ?? '';
  return (
    <form
      className="flex flex-col gap-2 border-border border-t bg-muted/30 px-4 py-3 sm:flex-row sm:items-center"
      onSubmit={(event) => {
        event.preventDefault();
        if (!site) return;
        invite.mutate(
          { projectId, email, role },
          {
            onSuccess: () => {
              toast.success(t('people.toast.invited', { name, site: site.name }));
              onDone();
            },
            onError: (error) => toast.error(friendlyErrorMessage(t, error, 'members.toast.inviteError', { 409: 'members.toast.alreadyMember' })),
          },
        );
      }}
    >
      <Select items={items} onValueChange={(next) => next && setChosen(next)} value={projectId || null}>
        <SelectTrigger aria-label={t('people.site')} className="w-full bg-background sm:w-56">
          <SelectValue placeholder={t('people.chooseSite')} />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <RoleSelect ariaLabel={t('settings.members.roleLabel')} className="w-full bg-background sm:w-32" onValueChange={setRole} value={role} />
      <div className="flex gap-2 sm:ms-auto">
        <Button onClick={onDone} type="button" variant="ghost">
          {t('common.cancel')}
        </Button>
        <Button disabled={!site} loading={invite.isPending} type="submit">
          <Mail className="size-4" /> {t('people.sendInvite')}
        </Button>
      </div>
    </form>
  );
}

function PendingInvitations({
  invitations,
  siteById,
  total,
}: {
  invitations: PeopleOverview['invitations'];
  siteById: Map<string, Site>;
  total: number;
}) {
  const t = useT();
  const { revoke } = usePeopleChanges();
  // One request per invitation: a row spins while its own revoke runs, and a
  // second click on it does nothing (the ref closes the same-frame gap).
  const [revoking, setRevoking] = useState<ReadonlySet<string>>(new Set());
  const inFlight = useRef(new Set<string>());
  const revokeInvitation = (invitation: PeopleOverview['invitations'][number]) => {
    if (inFlight.current.has(invitation.id)) return;
    inFlight.current.add(invitation.id);
    setRevoking(new Set(inFlight.current));
    revoke
      .mutateAsync({ projectId: invitation.projectId, invitationId: invitation.id })
      .then(() => toast.success(t('settings.members.toast.invitationRevoked')))
      .catch((error: unknown) => toast.error(friendlyErrorMessage(t, error, 'settings.members.toast.revokeError')))
      .finally(() => {
        inFlight.current.delete(invitation.id);
        setRevoking(new Set(inFlight.current));
      });
  };
  return (
    <section aria-labelledby="pending-invitations" className="rounded-xl border border-border bg-card">
      <h2 className="border-border border-b px-4 py-3 font-semibold text-sm" id="pending-invitations">
        {t('settings.members.pendingInvitations')}
      </h2>
      {total > invitations.length ? (
        <p className="border-border border-b px-4 py-2 text-muted-foreground text-xs">
          {t('people.invitationsLimited', { shown: invitations.length, total })}
        </p>
      ) : null}
      <ul className="divide-y divide-border">
        {invitations.map((invitation) => {
          const site = siteById.get(invitation.projectId);
          return (
            <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm" key={invitation.id}>
              <Mail aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-[12rem] flex-1 truncate" dir="ltr">
                {invitation.email}
              </span>
              <span className="text-muted-foreground" dir="auto">
                {site?.name} · {t(roleLabelKey(invitation.role))}
              </span>
              <Button
                aria-label={t('settings.members.revokeInvite')}
                loading={revoking.has(invitation.id)}
                onClick={() => revokeInvitation(invitation)}
                size="icon-sm"
                title={t('settings.members.revokeInvite')}
                variant="ghost"
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
