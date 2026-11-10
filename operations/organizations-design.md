# Organizations → Websites: design

Status: draft for review (Phase A). Owner of the work: the `feat/organizations` thread.

This document is the contract for the restructure. Every PR in the series links
here and must not contradict it; a change of plan changes this file first.

## 1. Problem

Today every website (`Project`) owns its own `Organization` 1:1
(`Project.organizationId @unique`). That org is the site's member boundary, so:

- there is no real "organization": the global dashboard is an aggregate over
  unrelated one-site orgs, and the word "workspace" means a site in some places
  and "all my sites" in others;
- billing/plan, usage, notification toggles and Git settings hang off the
  one-site org, so they surface inside **site** settings;
- inviting a person to several sites means one invitation per site, and the
  People page (#363) stitches those per-site memberships back together.

## 2. Target model

**Organization** — the account that owns websites.

- Owns: billing, plan and usage (with a per-website breakdown), members, org
  settings, and any number of websites.
- A user can belong to several organizations (org switcher).
- Org roles:

| Org role | Meaning |
| --- | --- |
| **Owner** | Exactly one. Everything Admin can do, plus delete the organization and transfer ownership. Changes hands only by transfer. |
| **Admin** | Manages the organization: members, invitations, join links, billing/plan, org settings, creating and deleting websites. **Implicitly Admin on every website**, including future ones. |
| **Member** | Belongs to the organization but sees **only the websites they hold a grant on** (zero is allowed). |

**Website** (`Project`) — belongs to exactly one organization. Has its own
settings, domains, Git, API keys, readers/audience, usage share, and a
**Members** tab.

- Site roles (per-website grant held by an org Member):

| Site role | Stored value | Can |
| --- | --- | --- |
| **Admin** | `admin` | Everything on this website: settings, domains, Git, API keys, readers, add-ons, integrations, and this website's members (grant/change/remove, invite new people scoped to this website). Cannot delete the website. |
| **Editor** | `member` | Write, comment, preview, publish; manage languages; see the team and usage; one-time exports; own AI assistant keys. |
| **Viewer** | `viewer` | Read-only dashboard access: content, drafts, history, analytics, read-only settings. |

The stored values reuse the existing `MemberRole` strings (`member` is labelled
"Editor" in the UI today), so `packages/shared/src/rbac.ts` (`canView`,
`canEdit`, `canAdminister`, `canAssignRole`) keeps working on the **effective
site role** without a second rank table.

**Effective site role** (the single function every access path calls):

```
effectiveSiteRole(user, project):
  m = Member(project.organizationId, user)        -- none → NO ACCESS (404)
  if m.role == owner  → owner
  if m.role == admin  → admin
  g = ProjectMember(project, m)                   -- none → NO ACCESS (404)
  return g.role                                   -- admin | member | viewer
```

A site grant on an org Admin/Owner is ignored while they hold that org role and
becomes effective again if they are demoted to Member (§6.7).

**Readers** (private-site audience: `Reader`, `Audience`, `ReaderInvitation`)
are unchanged and stay a separate concept: they read the published site, they
are not team members, and they never appear in Members screens. UI wording:
"Readers" (site audience) vs "Members" (team).

**Terminology** — one term everywhere (UI, emails, docs, all locales):
"Organization" (AR: «المؤسسة»), "Website" in navigation/headings where the
current UI says "Site" stays "Site"/«الموقع» — see §9 for the exact word list.
"Workspace" is retired.

## 3. Data model

```prisma
model Project {
  organizationId String            // was @unique — now many per org
  organization   Organization @relation(..., onDelete: Restrict)   // was Cascade
  members        ProjectMember[]
  @@unique([id, organizationId])   // composite target for grant FKs
  @@index([organizationId])
  // @@unique([slug]) and @@unique([organizationId, slug]) unchanged
}

/// A per-website grant for an org Member. Org Owner/Admins never need one.
model ProjectMember {
  id             String   @id @default(cuid())
  organizationId String
  projectId      String
  userId         String
  role           String   // admin | member (Editor) | viewer — never owner
  createdById    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  project Project @relation(fields: [projectId, organizationId], references: [id, organizationId], onDelete: Cascade)
  member  Member  @relation(fields: [organizationId, userId], references: [organizationId, userId], onDelete: Cascade)
  @@unique([projectId, userId])
  @@index([organizationId, userId])
  @@map("project_member")
}

/// Website grants an invitation will create on acceptance.
model InvitationGrant {
  invitationId String
  projectId    String
  organizationId String
  role         String   // admin | member | viewer
  invitation Invitation @relation(..., onDelete: Cascade)
  project    Project    @relation(fields: [projectId, organizationId], references: [id, organizationId], onDelete: Cascade)
  @@id([invitationId, projectId])
}

/// Website grants a join link gives each person who joins through it.
model JoinLinkGrant {
  joinLinkId String
  projectId  String
  organizationId String
  role       String   // admin | member | viewer
  joinLink JoinLink @relation(..., onDelete: Cascade)
  project  Project  @relation(fields: [projectId, organizationId], references: [id, organizationId], onDelete: Cascade)
  @@id([joinLinkId, projectId])
}
```

Invariants enforced **by the database**, not only by code:

1. A grant always lives in the same org as its website and its member
   (composite FKs) — a grant can never point across organizations.
2. Removing someone from the org deletes all their grants (cascade on the
   `Member` composite FK). Deleting a website deletes its grants, invitation
   grants and join-link grants.
3. `ProjectMember.role` is checked `IN ('admin','member','viewer')`
   (SQL `CHECK`), same for `InvitationGrant` / `JoinLinkGrant`.
4. `Member.role` meaning changes to org role: `owner | admin | member`.
   `viewer` is no longer a valid org role (migrated to grants, §10.1); a
   `CHECK` constraint is added after the data migration.
5. `Invitation.role` / `JoinLink.role` become the **org role** granted
   (`admin | member`; join links: `member` only, §6.2).
6. Deleting an org with websites is impossible at the DB level
   (`onDelete: Restrict`); the delete-organization flow erases each website
   explicitly first (§6.12).

7. `Organization.slug` becomes **required** and unique (backfilled in the
   migration: `slugify(name)`, `-2`, `-3`… on clash; reserved words such as
   `new`, `settings`, `welcome` refused). It is the org's URL handle (§5.4).

Supporting tables:

```prisma
/// Old slugs keep working after a rename: /app/o/<old> redirects to the current one.
model OrganizationSlugAlias {
  slug           String   @id
  organizationId String
  organization   Organization @relation(..., onDelete: Cascade)
  createdAt      DateTime @default(now())
}

/// Per-user dashboard preferences that are not auth state.
model UserPreference {
  userId             String  @id
  lastOrganizationId String?        // landing org; validated on read, never trusted
  notifications      Json    @default("{}")   // personal email prefs (§5.4.4)
  updatedAt          DateTime @updatedAt
}

model Notification {
  organizationId String?   // new: which org an item belongs to (null = account-level)
  // projectId stays: which website, when there is one
}
```

`session.activeOrganizationId` is no longer read by our code. The landing org
is `UserPreference.lastOrganizationId` (per user, not per device, as asked),
and **nothing is ever authorized from it**: every org API takes the org in its
path, every website API resolves the org from the website.

### Website data partition (`Project.dataTenantId`)

Analytics, usage, AI-conversation and erasure facts in ClickHouse, the usage
receipts in Postgres, sealed AI archives and queued worker jobs are all keyed
by `(tenant_id, project_id)` where `tenant_id` is today's org id. Moving a
website to another org would make its history invisible to current queries,
break pseudonymous hash continuity, fail queued jobs' tenant-equality checks
and let erasure miss old facts.

Decision: add **`Project.dataTenantId`**, immutable, set once: existing
websites → their current `organizationId` (unique per website today because
of the 1:1); new websites → a fresh id. Every reader/writer of those facts
uses `project.dataTenantId` instead of `project.organizationId`. One partition
therefore always belongs to exactly one website, forever: no ClickHouse
rewrite is ever needed, a merge changes nothing in ClickHouse or in queued
jobs, and a per-website deletion fence can never stop a sibling.

- `UsageStorageMarker` and `UsageIngestCheckpoint` re-key from
  `organizationId` to `dataTenantId` (same values for existing rows).
- `UsageProviderCheckpoint.organizationId` keeps its historical value
  (accepted reconciliation ids are never regenerated); new rows carry the
  website's `dataTenantId`.
- Org totals = sum over the org's websites' partitions.

### Org-level vs site-level data

Data that is genuinely per-website but stored on the one-site org today moves
to the website in PR 1, **before** any merge. Full list in §10.3.

## 4. Permission matrix

Legend: ✓ allowed · — not allowed (button hidden; API 403 for a visible
resource, 404 for a website/org the caller cannot see) · (own) only their own.

### 4.1 Organization actions

| Action | Owner | Admin | Member |
| --- | --- | --- | --- |
| See the organization in the switcher / its Websites page | ✓ | ✓ | ✓ (only granted websites listed) |
| Create a website | ✓ | ✓ | — |
| Delete a website | ✓ | ✓ | — |
| See org Members page (all members, all grants) | ✓ | ✓ | — |
| Invite by email (org role Member + website grants) | ✓ | ✓ | — (site Admins invite from the website's Members tab, §6.1b) |
| Invite as org Admin | ✓ | ✓ | — |
| Create / revoke / regenerate org join links | ✓ | ✓ | — |
| Change someone's org role (Member ↔ Admin) | ✓ | ✓ (not the Owner) | — |
| Remove someone from the org | ✓ | ✓ (not the Owner, not other Admins? → **allowed**, Admin ≥ Admin as today) | — |
| Transfer ownership (to an org Admin) | ✓ | — | — |
| Leave the organization | — (transfer first) | ✓ | ✓ |
| Usage & billing: view plan, org usage, per-website breakdown | ✓ | ✓ | — |
| Change plan / billing | ✓ | ✓ | — |
| Org settings: name, slug, logo, notification defaults | ✓ | ✓ | — |
| Delete the organization | ✓ | — | — |

### 4.2 Website actions (by effective site role)

Effective role: Owner/Admin of the org → `owner`/`admin` on every website.

| Action | owner / admin | Site Admin | Editor | Viewer | No grant |
| --- | --- | --- | --- | --- | --- |
| Open the website at all (dashboard, editor, preview, API, MCP…) | ✓ | ✓ | ✓ | ✓ | **404** |
| Read content, drafts, history, analytics, AI insights | ✓ | ✓ | ✓ | ✓ | 404 |
| Write / comment / publish / rollback | ✓ | ✓ | ✓ | — | 404 |
| Languages, one-time exports, own AI assistant keys | ✓ | ✓ | ✓ | — | 404 |
| Settings: general, domains, Git, add-ons, integrations, search/AI, readers, export schedules, API keys | ✓ | ✓ | — (read-only where today) | — (read-only where today) | 404 |
| Members tab: see who has access | ✓ | ✓ | ✓ | ✓ | 404 |
| Members tab: add an existing org member (role ≤ own) | ✓ | ✓ | — | — | 404 |
| Members tab: invite a new person (org Member + this website only) | ✓ | ✓ | — | — | 404 |
| Members tab: change / remove a grant on this website | ✓ | ✓ (not org Owner/Admins: they are "via organization") | — | — | 404 |
| Delete the website | ✓ | — | — | — | 404 |
| Usage for this website | ✓ | ✓ | ✓ | ✓ | 404 |

"Role ≤ own": `canAssignRole(actorEffectiveRole, targetRole)`; owner is never
assignable at either level.

### 4.3 The 404 invariant

A person without access to a website gets **404, never 403**, on every surface:
REST, RPC, MCP (tools and resources), API keys, Git webhooks and Git previews,
editor/collaboration, uploads/asset proxy, exports, analytics, AI and site
chat, search diagnostics, notifications and email deep links. The same holds
for organizations: a non-member gets 404 for any org-scoped route.

All of these call one server function — `resolveSiteAccess(userId, projectId)`
returning `{ project, organizationId, role }` or throwing `notFound('project')`
— and one org function `resolveOrgAccess(userId, organizationId)`. The
permission-matrix test suite (§8) asserts every route × role cell, including
404 for the "No grant" column and for a member of a **different** org.

API keys and MCP OAuth tokens act as their creator: a request authorizes iff
the creator's **current** effective role on the key's website allows it. A
creator removed from the website/org, demoted below the needed role, or
suspended stops their keys working on the next request (same rule as today,
now through `resolveSiteAccess`).

## 5. Information architecture

Two unmistakable levels, each with its own sidebar.

### 5.1 Organization level

URL prefix `/app/o/$orgSlug`. Header: the `[Org ▾]` switcher (§5.4.1); the
sidebar holds only the org's navigation.

| Nav item | Route | Who | Content |
| --- | --- | --- | --- |
| Websites | `/app/o/$orgSlug/websites` (`/app/o/$orgSlug` redirects here) | everyone | Cards/list of websites you can open (status, last publish, your role badge for Members). "New website" for Owner/Admin. First-run checklist (today's overview) for the newest website. Empty state for Members without grants: "You don't have access to any websites in <Org> yet. Ask an Admin: <names>." |
| Analytics | `/app/o/$orgSlug/analytics` | everyone | Today's cross-site analytics, limited to websites you can open. |
| Members | `/app/o/$orgSlug/members` | Owner/Admin | Members table (person, org role, website access summary "All websites" / "3 websites"), row → access drawer (§6.6). Tabs: Members · Invitations · Join links. "Invite people" button. |
| Usage & billing | `/app/o/$orgSlug/billing` | Owner/Admin | Plan, org totals, per-website breakdown table, editor seats. |
| Settings | `/app/o/$orgSlug/settings` | Owner/Admin | General (name, URL handle, logo), Invitations ("Send invitation emails" — off means copy-link only), Danger zone (leave / transfer / delete). Members without admin rights see only "Leave organization" (also reachable from the switcher). |

Account settings stay user-level at `/app/settings` (§5.4.4), reached from
the user menu only — never in an org or site nav.

Legacy routes redirect to the landing org (§5.4.3): `/app` → its Websites;
`/app/sites` → its Websites; `/app/people` and `/app/members` → its Members;
`/app/analytics` → its Analytics.

### 5.2 Website level

URL stays `/app/projects/$projectId/*` (every existing deep link, email and
notification keeps working; the org is derived from the website).

- Header breadcrumb: **Org › Website › Section**. "Org" links to the org's
  Websites page; "Website" is a **site switcher** limited to websites of the
  same org you can open.
- Sidebar: Overview · Editor · Analytics · AI · Settings (unchanged).
- Settings groups:

| Group | Sections |
| --- | --- |
| Website | General, Appearance, Languages, Domains, Access & readers, Search, Add-ons |
| Publishing | Git, OpenAPI, Content import |
| Team & access | **Members**, API keys |
| Usage | Usage for this website (+ "Plan and billing are managed by <Org> →", link only for org Owner/Admin) |
| Advanced | Integrations, Smart AI, Exports, Danger zone (delete website: org Owner/Admin only) |

Removed from website settings: **Plan** (→ org Usage & billing) and
**Notifications** (→ org Settings), each replaced by a one-line pointer where
someone would look for it.

### 5.3 Website Members tab

```
Members of <Website>                                   [Add people]
Who can open this website. Organization Owner and Admins can open every website.

From the organization
  Sara Haddad      sara@…     Owner   · via organization
  Omar K.          omar@…     Admin   · via organization
Website access
  Lina M.          lina@…     [Editor ▾]        [Remove from website]
  Ziad T.          ziad@…     [Viewer ▾]        [Remove from website]
Pending invitations (to <Org>, with access to this website)
  new@acme.com     Editor  · expires in 6 days  [Copy link] [Revoke]
```

"Add people" opens one dialog with a single input: typing matches org members
(name/email) **and** accepts any email. Picking an org member adds a grant
immediately; an unknown email becomes an org invitation (org role Member) with
a grant on this website. Role select defaults to Editor.

### 5.4 Belonging to several organizations

This is the normal case, not an edge case: after the merge-by-owner migration
(§10.2) anyone who worked on sites of two different owners is in two orgs, so
everything below ships in PR 2, not later.

#### 5.4.1 The switcher: `[Org ▾] / [Website ▾]`

The shell header starts with a two-part breadcrumb switcher (it replaces the
sidebar's current site switcher, so there is exactly one place to change
context):

- **Org level:** `[Org ▾]` only, then the page title.
- **Website level:** `[Org ▾] / [Website ▾] / Section`.

Each part is its own button. The common action — another website in the same
org — is one click on `[Website ▾]`, which opens a compact list of **this
org's** websites you can open (search on top, nothing else).

`[Org ▾]` opens a fixed-size popover (≈ 640 × 440 px), two panes on desktop:

```
┌──────────────────────────────┬──────────────────────────────────────┐
│ 🔍 Search orgs and websites   │ Acme Docs                Owner  ⚙    │
│ RECENT                       │ ● Developer docs   docs.acme.com     │
│  ● API reference · Acme Docs │ ● API reference    acme.nibleaf.app  │
│  ○ Handbook · JOODPMS        │ ○ Handbook (draft) —                 │
│  ● Status · Sara's org       │                                      │
│ ORGANIZATIONS                │                                      │
│ ▸[A] Acme Docs        Owner  │                                      │
│  [J] JOODPMS          Member │                                      │
│  [S] Sara's org       Admin  │                                      │
├──────────────────────────────┴──────────────────────────────────────┤
│ + New website (in Acme Docs)                    + New organization    │
└─────────────────────────────────────────────────────────────────────┘
```

- **Left pane:** search, **Recent** (last 3 websites across all orgs, each
  with its org name; from `UserPreference`), then **Organizations** (logo or
  initials, name, your role badge). Current org first, then last opened.
- **Right pane:** websites of the org that is hovered **or** focused with the
  arrow keys on the left (focus wins; no hover-only behaviour). Each row: icon
  or favicon, name, primary domain (or default subdomain), live/draft dot.
  Only websites you can open; an org with none shows "No websites you can open
  yet" (Members) or "No websites yet — create one" (Owner/Admin). Header: org
  name, role badge, ⚙ to that org's Settings (Owner/Admin).
- **Actions:** website row → straight into it (the org follows from the
  website); org name/row Enter → that org's Websites page; footer
  "+ New website" only when you can create one in the org shown on the right;
  "+ New organization" always.
- **Search** filters orgs and websites together: one flat result list, website
  results show `Website · Org`. Server-side above ~200 websites, client-side
  below.
- **One org:** `[Org ▾]` is still shown (people must see the org exists and
  reach Members/Billing). Its popover leads with that org's websites — the
  left pane collapses to search + Recent, the right pane becomes the main
  list; "+ New organization" stays in the footer.
- **Scale:** 1 org/1 site through 20 orgs/200 sites: both panes scroll
  independently inside the fixed popover (virtualised when a list exceeds 50
  rows); a skeleton fills the right pane while an org's websites load (the
  list is prefetched on hover/focus of the org row).
- **Mobile (≤ 640 px, incl. 390 px):** a full-height sheet with drill-down.
  Screen 1: search, Recent, Organizations. Tapping an org opens screen 2 with
  its websites, a back arrow, and the org header (Websites page link, ⚙).
  Footer actions pinned at the bottom. Tap targets ≥ 44 px.
- **Keyboard:** opens from the command palette ("Switch organization or
  website…") and with the sequence `G` then `O` (`G` then `W` opens
  `[Website ▾]`), ignored while typing in a field. Sequences instead of
  modifier chords because every free-looking chord is taken by a browser
  (`Ctrl+Shift+O` Chrome bookmarks, `Ctrl+Shift+S` Firefox screenshots, …). Up/Down move within a pane; Right/Left move between panes
  (mirrored in RTL); Home/End; Enter opens; Esc closes and returns focus to
  the trigger. Typing in any list focuses search. Roles: the triggers are
  `button`s with `aria-haspopup="dialog"`; the popover is a `dialog` labelled
  "Switch organization or website"; each pane is a `listbox` with
  `aria-activedescendant`; options carry `aria-selected` for the current
  org/website. Screen-reader text on each website: "<name>, <org>, live".
- **RTL:** panes mirror (orgs on the right, websites on the left), arrow keys
  mirror, names isolated with `<bdi>`.
- **Data:** one request `GET /app/me/switcher` → orgs (id, slug, name, logo,
  role, canCreateWebsite) + recent websites; websites per org lazily from
  `GET /app/organizations/:id/projects?view=switcher` (id, name, icon, domain,
  live). Both only return what the caller can open.

#### 5.4.2 URLs carry the org

- Org pages: `/app/o/$orgSlug/{websites,analytics,members,billing,settings}`.
  Links are shareable and two tabs can show two orgs independently — there is
  no client-side "current org" state other than the URL.
- Slug rather than id (master's direction, kept): readable in links and
  emails. A rename never breaks a link: changing the URL handle records the
  old one in `OrganizationSlugAlias`, and `/app/o/<old>` redirects (only for
  members; non-members get the same 404 as any unknown slug, so slugs are not
  an existence oracle).
- Website pages keep `/app/projects/$projectId/*`: the website implies its
  org, so the shell renders that org in the switcher/breadcrumb automatically
  and records it as the user's last org. Existing deep links, emails and
  notifications keep working unchanged.
- Server: org endpoints are `/app/organizations/:organizationId/...` (id, not
  slug, so a rename mid-request cannot retarget a mutation); the client
  resolves slug → id once via `GET /app/organizations/by-slug/:slug`.
  Authorization is always by the **resource's** org (§4.3), never by session
  state, so a stale tab can at worst show stale data, never act on the wrong
  org.

#### 5.4.3 Landing

| Situation | Lands on |
| --- | --- |
| Sign-in / opening `/app` | `UserPreference.lastOrganizationId` if still a member → its Websites. Otherwise the org they own, else the oldest membership. |
| Sign-in with a `redirect` (deep link) | That link (as today). |
| After accepting an invite / joining by link | That org: its only website when they can open exactly one, else its Websites (§6.3.1). |
| Zero orgs, never had one | `/app/welcome`: "Create your organization" (name prefilled "<First name>'s organization") and, if any, pending invitations for their verified email with Accept. |
| Zero orgs after a revoked/expired invite (sign-up skipped the starter org) | `/app/welcome` with "You don't have access to an organization yet. Ask whoever invited you for a new invitation, or create your own organization." |
| Zero orgs after leaving / being removed | `/app/welcome` (same screen, neutral wording). |

`lastOrganizationId` is written when the user opens any org page or website
(debounced, one tiny `PUT /app/me/last-organization`).

#### 5.4.4 Personal vs organization

| Lives in | What |
| --- | --- |
| **Account** (`/app/settings`, user menu; no org chrome — the shell shows a plain "Account" header and a "Back to <last org>" link) | Profile, email, sign-in methods, sessions/devices, appearance and interface language, **personal email notifications**, personal AI assistant keys overview, "Delete account" (refused while you own an org: transfer or delete it first). |
| **Organization** | Members, invitations, join links, plan, billing, usage, org name/handle/logo, "send invitation emails", delete org. |
| **Website** | Everything in §5.2. |

Notification toggles are split by who they are about:
- personal (per user, default on, in Account): security sign-in alerts,
  deploy succeeded/failed, someone joined (admins), new website created,
  weekly digest, plan/usage alerts;
- organization behaviour (Org settings): send invitation emails.

Migration of today's per-site toggles: a personal toggle starts **off** only
if it was off in every org the user belongs to (the rule `security_login`
already uses), so nobody suddenly gets emails they had silenced everywhere.
The org's "send invitation emails" is off only if `member_invited` was off on
every website merged into it; mixed values are listed in the dry-run report
and resolve to on (the copy-link path works either way).

#### 5.4.5 Cross-org surfaces

- **Notifications inbox** (bell): one inbox across all orgs. Each item shows
  `Org · Website` above the text (org avatar). Filter chip: "This organization
  / All". Items for an org or website the user can no longer open are
  **hidden** (filtered server-side by current access, unread count included),
  so the inbox never leaks names after removal and never offers a dead link.
- **Clicking an item from another org** navigates there; the shell switches
  org from the URL (no prompt).
- **Command palette / search**: scoped to the current org (its websites and
  pages you can open), plus commands "Switch organization…" (lists orgs),
  "Create organization", "Account settings". At website level the scope is
  the website's org.
- **Emails**: every link is absolute and resource-addressed —
  `/app/projects/$id/...` for website events, `/app/o/$slug/...` for org
  events (invitation, member joined, billing). Subjects name the org:
  "[Acme Docs] Lina joined", and website events "Acme Docs · API: deploy
  failed".

#### 5.4.6 Leaving and removal while you're looking

- Leave is offered to everyone but the Owner (switcher row menu and org
  Settings); the Owner sees "Transfer ownership or delete the organization
  to leave".
- If you are removed from (or leave) the org you're viewing, the next request
  for it returns 404; the shell's org query turns that into a redirect to your
  landing org (§5.4.3) with a toast "You no longer have access to <name>" (name
  from the client cache, never from the server). Losing one website's grant
  does the same at website level: back to that org's Websites with "You no
  longer have access to <website>".
- Demotion (Admin → Member) while viewing an Owner/Admin-only page: the page's
  403 becomes the standard "Administrator access required" state with a link
  to Websites.

#### 5.4.7 API keys, MCP and OAuth

- API keys stay website-scoped; they authorize through `resolveSiteAccess` on
  the creator (§4.3).
- MCP OAuth consent (`/oauth/project`) lists only websites the user can open,
  **grouped by org** (org heading, websites beneath; one org → no heading).
- MCP tools that list websites (`list_projects` and similar) return only
  accessible websites, each with `organization: { id, name }`, so an agent can
  disambiguate same-named websites in different orgs.
- Admin panel (platform staff): sites table gains the org column and filter;
  "Invite organization" creates an org with an owner invitation as today.

## 6. Flows (step by step)

Common rules: every mutation runs in a transaction that locks the org row
(`FOR NO KEY UPDATE`, as `members.ts` does today) so concurrent role changes
cannot interleave; every one re-reads the actor's current role inside it.

### 6.1 Invite by email (org Members page)

1. Owner/Admin → Members → **Invite people**.
2. Dialog: emails (several, comma/newline), **Organization role**: Member
   (default) or Admin.
3. If Member: **Website access** — checklist of websites, each with a role
   select (Editor default). "None yet" is allowed (they join with no website).
   If Admin: replaced by the note "Admins can open every website."
4. Send → one `Invitation` per email (org role) + `InvitationGrant` rows.
   Already-members: no invitation; their selected grants are added directly
   and reported ("Lina already belongs — access updated").
5. Email: "<Inviter> invited you to join <Org> on Nibleaf" + what they get
   ("Admin of every website" or a list "Docs (Editor), API (Viewer)").
   7-day expiry. "Copy invite link" in the pending list works without email.

### 6.1b Invite from a website's Members tab

Same as 6.1 but fixed to: org role Member, one grant on this website with the
chosen role. Allowed for site Admins (incl. via org). The invitation shows up
in the org's Invitations tab too (with "invited from <Website>").

### 6.2 Invite by link (join link)

1. Owner/Admin → Members → Join links → **Create link**.
2. Fields: label, website grants (checklist + role each; at least one
   website), optional allowed email domain, expiry (never / 1 / 7 / 30 days),
   max uses. Org role is always **Member** — an Admin cannot be minted by a
   link.
3. The URL is shown once (only its hash is stored). Copy. No email is sent.
4. Revoke (final) / Regenerate (new token, same settings). Recent joins listed.
5. A link works only while its creator could still grant every one of its
   grants (current org Owner/Admin, or current site Admin of each granted
   website) — otherwise it shows as disabled and admits nobody.

### 6.3 Accept an email invitation — every case

Entry `/accept-invite/:id`. The server endpoint is ours
(`POST /app/invitations/:id/accept`); better-auth's accept endpoint is disabled
so no path can create a `Member` without applying the grants.

| Case | What the person sees / what happens |
| --- | --- |
| Signed in, email matches | "Join <Org>" card listing the access → Accept → member + grants in one transaction → land (§6.3.1). |
| Signed in, different email | "This invitation is for a…@x.com. You're signed in as b…@y.com." [Switch account] (signs out, returns here). No accept button. |
| Signed out, account exists | Sign in (email OTP / Google) with the email prefilled → back here → Accept. |
| Signed out, no account | Sign up (email prefilled, OTP) → no starter organization is created because an invitation is pending → back here → Accept. |
| Already a member | Grants from the invite are merged (a grant is upgraded, never downgraded) → "You're already in <Org>" → Open. |
| Expired | "This invitation expired. Ask <inviter> for a new one." |
| Revoked / unknown | Same single "not valid" state (no oracle). |
| Already accepted | "Already used." Signed in as the invitee → "Open <Org>". |

6.3.1 **Landing**: exactly one website accessible in that org → that website's
Overview; otherwise the org's Websites page. The org becomes the last-opened
org.

### 6.4 Join through a link — every case

`/join/:token` shows: org name, the websites and roles it grants, domain rule.

| Case | Behaviour |
| --- | --- |
| Signed in, verified, domain ok | Join → member (org Member) + grants, use counted atomically → land (§6.3.1). |
| Already a member | Grants merged (upgrade-only), use **not** counted → land. |
| Signed out | Sign in / sign up; the token rides in the short-lived cookie as today; sign-up skips the starter organization → back → Join. |
| Unverified email | "Verify your email first" (OTP flow). |
| Wrong domain | "Only @x.com addresses can join with this link." |
| Revoked / expired / used up / creator lost authority / unknown | One "This link is not valid" state. |

### 6.5 Add an existing org member to a website

Website → Members → Add people → pick member → role → Add. Grant created
(upgrade-only if one exists). Also available from the org Members access
drawer (§6.6).

### 6.6 Change roles

- **Org role** (Owner/Admin, Members page row menu): Member → Admin: confirm
  "Admins can open and manage every website and the organization's billing."
  Existing grants are kept dormant. Admin → Member: dialog "Which websites can
  they still open?" prefilled with their dormant grants; confirming writes
  exactly that set.
- **Site role**: Website → Members role select, or org Members → person →
  access drawer (checklist of websites with role per site; Save applies the
  diff). Owner/Admins appear as "via organization" and are not editable there.

### 6.7 Remove

- From a website: Website → Members → Remove from website (site Admin+).
  Deletes the grant; they stay in the org. Their join links granting this
  website stop working (creator check).
- From the org: org Members → Remove from organization (Owner/Admin; Admin
  cannot remove the Owner). Deletes the `Member` row → all grants cascade;
  their join links are revoked; their sessions keep working but every website
  of the org now 404s; API keys they created stop working.

### 6.8 Leave the organization

Org switcher or Settings → Leave. Owner must transfer first. Confirm → member
row deleted (grants cascade) → redirect to another org or `/app/welcome`.

### 6.9 Transfer ownership

Owner → Settings → Danger zone → Transfer ownership → pick an org **Admin**
(Members must be promoted first) → confirm by typing the org name → target
becomes Owner, previous Owner becomes Admin (existing
`planOwnershipTransfer`).

### 6.10 Create a website

Owner/Admin → Websites → New website (name, optional description/icon) →
created in **this** org (no new organization), default language + branch +
add-ons as today → opens the website Overview. A plain Member does not see the
button; the API refuses with 403 (they can see the org).

### 6.11 Delete a website

Website → Settings → Danger zone (org Owner/Admin) → type the website name →
website erased (content, analytics, search, storage, usage facts for that
project) → back to the org's Websites. The org and its members remain.

### 6.12 Delete the organization

Owner → Settings → Danger zone → dialog lists every website that will be
deleted ("3 websites, 412 pages") → type the org name → each website is erased
with the website erasure, then the org (members, invitations, links, plan).
Refused while a website is still being erased; resumable if interrupted.

### 6.13 Switch organization

Org switcher → pick org → `/app/o/$orgSlug/websites`; it becomes the
last-opened org (§5.4).
Inside a website, the switcher in the breadcrumb only lists websites of that
website's org; switching org always goes to the org's Websites page.

### 6.14 Create an organization

Org switcher → Create organization → name → empty org, caller is Owner, default
plan → Websites empty state "Create your first website". Sign-up still
provisions "<First name>'s organization" with the starter website, unless the
person arrives through a pending invitation or a valid join link.

## 7. Server design

- `packages/shared/src/rbac.ts`: org-role helpers (`ORG_ROLES`,
  `ASSIGNABLE_ORG_ROLES = [admin, member]`, `ASSIGNABLE_SITE_ROLES = [admin,
  member, viewer]`), `effectiveSiteRole(orgRole, grantRole|null)`.
- `apps/server/src/lib/access.ts`: `resolveSiteAccess`, `resolveOrgAccess`,
  `accessibleProjectIds(userId, organizationId?)` — one SQL each, used by
  guards, MCP, API keys, analytics, listings, notifications.
- Guards: `requireProjectMember/Role` call `resolveSiteAccess`;
  new `requireOrgRole(role, param='organizationId')` reads the org id from the
  path; `requireRole` (active-org based) is deleted.
- New modules: `organizations` (list mine, create, get, update, delete,
  leave, transfer), `org-members` (list, invite, update org role, update
  access, remove), `org-invitations` (list, cancel, resend; public info;
  accept), `org-join-links` (CRUD + join), `project-members` rewritten to
  grants.
- better-auth organization plugin: keep the tables and `set-active` (used by
  admin support sessions). Disable `create`, `update`, `check-slug`,
  `remove-member`, `update-member-role`, `leave`, `accept-invitation`,
  `reject-invitation`, `cancel-invitation`, `get-invitation`,
  `list-invitations`, `list-user-invitations`, `list-members`,
  `get-full-organization`, `get-active-member`, `get-active-member-role`,
  `has-permission` (`invite-member` and `delete` are already off). Membership,
  roles and rosters then change only through our actions, which apply grants
  and visibility rules; the `afterCreateOrganization` starter-site hook goes.
- Notifications: `member_joined` and friends fan out to org Owner/Admins and to
  site Admins of the granted websites; links point at the org Members page or
  the website Members tab. Notification `projectId`-scoped rows are hidden from
  a user who can no longer open that website.
- Every non-route path that decides team access moves to `resolveSiteAccess`
  too, not only the REST guards: website listings and aggregate analytics
  (relational and ClickHouse branches), people/suggestion queries, add-on
  action-local checks, API-key and MCP OAuth actor resolution (`resolveActor`
  takes the project and recomputes the role on each request), the OAuth
  project chooser and pending selection, private-site team checks
  (dashboard-session reader check, site email sign-in identity,
  `SiteMemberSession` revalidation on every request), private Git previews,
  the duplicate-domain conflict message (names the holder only if the caller
  can open it), reader access request suppression and recipients, worker
  deploy notifications.
- Readers stay outside this: public sites and invited/JWT readers keep their
  own rules. The 404 invariant is about team access (dashboard, APIs,
  credentials, unpublished drafts).
- Erasure split: `eraseProject(projectId)` cleans one website (content,
  storage, search, its `dataTenantId` partition and fence) and deletes the
  project row; `eraseOrganization(orgId)` erases each website, then the org.
  `Project → Organization` is `onDelete: Restrict`, so no org delete can
  cascade past website erasure.
- Account deletion: refused while the user owns an org that has other members
  ("Transfer ownership or delete <Org> first"); a sole-member org is erased
  with `eraseOrganization`. Replaces "promote the oldest member".
- Platform admin: "Invite organization" keeps creating org + first website +
  owner invitation; user/site screens show org role and website grants
  separately; support access carries the target website.

## 8. Tests

- `permission-matrix.test.ts` extended to (org role × site grant × route) with
  a second org as the cross-tenant control; every website route asserts 404
  for "no grant" and "other org".
- Postgres tests: grant invariants (composite FK, cascades, CHECK), invite
  accept (all §6.3 rows), join (all §6.4 rows, concurrent max-uses), demotion
  dialog semantics, transfer, leave, delete website/org.
- Migration tests on a realistic seed (§10.5).
- Browser E2E (dev stack): every §6 flow in EN and AR (RTL), desktop and 390px,
  with screenshots/video in the PRs — explicitly including the org switcher
  with 1 and 3 orgs, two tabs on two orgs, zero-org onboarding (`/app/welcome`,
  both wordings), the inbox with items from two orgs and after removal, and
  removal while viewing.

## 9. Wording

| Concept | EN | AR |
| --- | --- | --- |
| Organization | Organization | المؤسسة |
| Website | Website (nav "Websites"; "site" allowed in running text) | الموقع |
| Org member list | Members | الأعضاء |
| Site role Admin / Editor / Viewer | Admin / Editor / Viewer | مسؤول / محرر / مشاهد (existing keys) |
| Org role Owner / Admin / Member | Owner / Admin / Member | المالك / مسؤول / عضو |
| Inherited access | via organization | عبر المؤسسة |
| Site audience | Readers | القرّاء |

"Workspace" / «مساحة العمل» is removed from UI strings, emails and docs (the
glossary entry is replaced).

## 10. Migration

### 10.1 Deploy-time conversion (in the SQL migration, PR 1)

Runs once inside the Prisma migration, so the deploy is atomic with the new
access rule (otherwise every Editor/Viewer would lose access the moment the new
code ships). No org is merged here.

For every org with exactly one website P:

| Old `Member.role` | New `Member.role` | Grant on P |
| --- | --- | --- |
| owner | owner | — (implicit) |
| admin | **member** | admin |
| member | member | member (Editor) |
| viewer | member | viewer |

Platform-admin bootstrap invitations (`role = owner`, the org's first owner)
are left as they are. Other pending invitations: `role` admin/member/viewer → org role `member` +
`InvitationGrant(P, old role)`. Join links: same (`role` → `member`,
`JoinLinkGrant(P, old role)`). Orgs with zero websites: members unchanged
except `viewer` → `member`; invitations/links of such orgs are revoked
(`status = 'canceled'`, `revokedAt = now()`) since there is nothing to grant.

**Decision — no automatic org Admins.** A site Admin becomes an org Member with
a site-Admin grant, never an org Admin, even when they administered every
website of that owner. Org Admin implies authority over billing, all members
and every **future** website, which no one but the owner held across sites
before. This keeps "privilege never expands" unconditional and easy to verify;
the report lists people who were Admin everywhere so owners can promote them
in one click (Members page highlights "Admin on all websites").

### 10.2 Merge per owner (separate, operator-run script, PR 1)

`pnpm --filter @nibleaf/server org:merge -- --dry-run | --apply | --restore <runId>`

1. Group orgs by their single Owner `U` (orgs with ≠ 1 owner are left alone
   and reported).
2. Survivor = U's owned org with the most websites, tie → oldest `createdAt`,
   tie → lowest id. Reason recorded.
3. Name: survivor's name, except an auto-generated "<X>'s workspace" /
   "My workspace" becomes "<X>'s organization" / "My organization". Slug: the
   survivor keeps the slug backfilled by the PR 1 migration; each merged org's
   slug becomes an `OrganizationSlugAlias` of the survivor, so any
   `/app/o/<old>` link redirects to the merged org.
4. For each other org `O` of the group, in one transaction per group:
   - move its website(s): `project.organizationId = survivor`;
   - members: each person gets one survivor `Member` (role `member` unless they
     are `U`); their grants move with the website (`ProjectMember` rows are
     re-pointed; a person on several websites keeps one grant per website with
     that website's role);
   - pending invitations and join links: re-pointed to the survivor with their
     grants (ids and token hashes unchanged, so emailed and shared links keep
     working); if an invitee is already a survivor member, the invitation stays
     and only adds grants on accept;
   - per-site data that still lives on `O` (see §10.3) is already on the
     project after PR 1; org-only data of `O` is resolved per §10.3;
   - `O` is deleted only after all of the above (members, plan rows,
     metadata), never before.
5. Plan merge: the survivor keeps the **highest-ranked active plan** of the
   group (rank by `UsagePlan` order: custom/enterprise > paid > free; tie →
   most recent `effectiveAt`); conflicts (different paid plans, different
   expiries) are listed in the dry-run report and the run **refuses to apply a
   group with a plan conflict** unless `--accept-plan-conflicts` is passed after
   review.
6. Usage history: usage facts stay keyed by their original `organizationId` in
   ClickHouse; PR 1 changes every usage read to filter by **projectId**
   (website share) or `projectId IN org's websites` (org totals), so history
   follows the website without rewriting ClickHouse. Checkpoints / storage
   markers are re-pointed or summed as listed in §10.3.

Idempotence: the script is a no-op when no owner has more than one org. Each
group is one transaction; a crash leaves groups either fully merged or
untouched.

Journal: every change is written to `org_merge_journal(run_id, group_owner,
table, row_id, before jsonb, after jsonb)` in the same transaction, so
`--restore <runId>` replays `before` images in reverse order (recreating
deleted orgs/members with their original ids). Production still takes a
`pg_dump` first; restore is tested in CI on the seed.

### 10.3 Org-scoped data: move or merge

PR 1 moves every per-website value off the organization (copied exactly, never
rotated), so the merge script (§10.2) never has to choose between two sites'
values.

| Data (today on the one-site org) | Decision | When |
| --- | --- | --- |
| `metadata.git` (provider, repo, branch, path, import branch/language ids, push-to-deploy, sync bookkeeping) | **Move** to `ProjectGitSettings` (project-owned row); readers/writers switch to it | PR 1 migration |
| `OrganizationGitWebhookSecret` (+ legacy `metadata.git.webhookSecret`) | **Move** to `ProjectGitWebhookSecret(projectId)`, exact value, so every configured provider webhook keeps verifying | PR 1 migration |
| `metadata.integrations` (legacy) | **Move** to the website (server-only legacy field), never in any org DTO | PR 1 migration |
| `metadata.notifications` | **Split**: personal toggles → `UserPreference.notifications` (off only if off in every org the user is in); `member_invited` → org setting "send invitation emails" (§5.4.4) | PR 1 migration (personal), merge (org) |
| `metadata.plan` / `metadata.entitlements` (compat) and `OrganizationUsagePlan` | **Org**. Merge: highest-ranked active plan, tie → most recent; conflicting paid plans block `--apply` for that group until reviewed | merge |
| `UsageStorageMarker`, `UsageIngestCheckpoint`, `UsageProviderCheckpoint` | **Website partition** via `dataTenantId` (§3) | PR 1 migration |
| ClickHouse analytics/usage/AI facts, sealed archives, queued jobs | **Unchanged** (keyed by `dataTenantId` = old org id) | — |
| Redis draft-AI daily quota (keyed by org) | **Org** budget (billing is org-level). After a merge the survivor's counter applies; the others expire within 24 h | — |
| Editor seats (`countEditorSeats`) | **Org**: distinct users who are Owner/Admin or hold any Admin/Editor grant; Viewer-only and no-grant members are not seats | PR 1 |
| `Organization` name/slug/logo | **Org**; survivor keeps its own, merged slugs → aliases (§10.2) | merge |
| `Member`, `Invitation`, `JoinLink(+Use)` | Converted per §10.1, re-pointed per §10.2 (ids/hashes unchanged) | PR 1 / merge |
| `session.activeOrganizationId` | Ignored by our code | — |
| `IntegrationAuditEvent.organizationId`, `PlatformEvent.metadata.organizationId` | **Historical provenance**, never rewritten | — |
| `ApiKey`, `McpOAuthGrant`, MCP audit/idempotency, `ProjectIntegration`, AI settings in `Project.config`, two-way `GitConnection` and descendants, readers/audiences, content, assets, domains, deployments, exports | Already website-owned. Only their **access checks** change (§7) | PR 1 |
| `Notification` | Gains `organizationId`; old rows backfilled from their `projectId`'s org; inbox filtered by current access | PR 1 |
| Unknown `metadata` keys | The dry-run lists every key found in production; unknown keys are kept on the survivor and copied to a per-website `legacyOrgMetadata` until classified | merge |

### 10.4 Dry-run report (per owner)

```
Owner sara@example.com (user_123)
  survivor org_A "Sara's workspace" → "Sara's organization"  (reason: 2 websites, oldest)
  merges org_B "API Docs" (1 website: api-docs)
  people: 5 → 4 org members (1 shared)
    lina@…   member  grants: docs=admin, api-docs=member
    omar@…   member  grants: api-docs=admin     ← was Admin on every website: candidate for org Admin
  invitations: 2 moved (with grants) · join links: 1 moved
  plan: free + free → free (no conflict)
  per-site settings moved: notifications(conflict: member_invited off in org_B → kept per-website)
```

### 10.5 Test seed

Multiple owners; an owner with 1 site, one with 3 sites; a person shared by two
owners' sites with different roles; admins, editors, viewers; pending
invitations and join links (with uses) on non-survivor orgs; API keys, Git
connections (with webhook secrets), MCP OAuth grants, readers/audiences;
paid + free plans (conflict case); an org with zero websites; a legacy
two-owner org. Tests assert: no one gains a website or a role they did not
have; every API key/Git webhook/preview keeps working; invitation and join
URLs keep working; dry-run makes no writes; apply twice = apply once; restore
returns the exact pre-run rows.

### 10.6 Production

Deploy PR 1 (conversion runs in the migration). `pg_dump`. Run `--dry-run`
through the audit thread's deploy path; review the report (JOODPMS first).
`--apply`. Spot-check. Never run by the feature thread directly.

## 11. PR plan (merge order; each works alone)

1. **Data model + conversion + server authorization + merge script + tests.**
   Schema, migration, `resolveSiteAccess` everywhere, org-scoped APIs, better-auth
   endpoint lockdown, per-site data moved off the org, usage reads by
   project, permission-matrix suite, merge script with dry-run/journal/restore.
   UI: minimal adaptations only so nothing breaks (site Members tab reads
   grants).
2. **Org-level navigation and pages + site-level navigation split.** Org
   switcher, `/app/o/$orgSlug/*`, redirects, breadcrumb Org › Website, settings
   regrouping, Usage & billing, org Settings, create/delete org/website.
3. **Invites, join links, Members UI, emails, docs, i18n.** Org Members page
   (access drawer, invitations, join links), website Members tab, accept/join
   pages for every case, emails, `docs/product/team.mdx` (EN + AR), all
   locales.
