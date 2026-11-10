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
  if m.orgRole == owner  → owner
  if m.orgRole == admin  → admin
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

Prisma 7.10 / PostgreSQL. Sketches; the migration SQL is in PR 1.

```prisma
model Organization {
  slug             String     @unique   // required (better-auth's schema requires it)
  needsRepair      Boolean    @default(false)  // ownerless legacy org: org mutations refused (§10.1)
  deletionStartedAt DateTime?            // deletion fence (§6.12)
  handles          OrganizationHandle[]
}

model Member {
  role    String   // LEGACY site role, unchanged; new code writes the least-privilege mirror (§10.1)
  orgRole String   // owner | admin | member — the only role new code reads
  @@unique([organizationId, userId])      // existing; target of ProjectMember FK
  // partial unique index: one orgRole = 'owner' per organizationId
}

model Project {
  organizationId String            // was @unique — now many per org
  organization   Organization @relation(..., onDelete: Restrict)   // was Cascade; Restrict lands in the contract PR (§10.1)
  dataTenantId   String  @unique   // immutable partition key (below)
  @@unique([id, organizationId])   // composite target for grant FKs
  @@index([organizationId])
}

/// A per-website grant for an org Member. Org Owner/Admins never need one.
model ProjectMember {
  id             String   @id @default(cuid())
  organizationId String
  projectId      String
  userId         String
  role           String   // admin | member (Editor) | viewer — CHECK
  createdById    String?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  project Project @relation(fields: [projectId, organizationId], references: [id, organizationId], onDelete: Cascade, onUpdate: Cascade)
  member  Member  @relation(fields: [organizationId, userId], references: [organizationId, userId], onDelete: Cascade, onUpdate: Cascade)
  @@unique([projectId, userId])
  @@index([organizationId, userId])
}

model Invitation {
  kind    String  @default("member")  // member | bootstrap_owner
  orgRole String  @default("member")  // admin | member (owner only with bootstrap_owner)
  @@unique([id, organizationId])      // composite target for InvitationGrant
}

/// Website grants an invitation creates on acceptance. Both parents carry the
/// org id, so a grant can never name a website of another org.
model InvitationGrant {
  invitationId   String
  organizationId String
  projectId      String
  role           String   // admin | member | viewer — CHECK
  invitation Invitation @relation(fields: [invitationId, organizationId], references: [id, organizationId], onDelete: Cascade, onUpdate: Cascade)
  project    Project    @relation(fields: [projectId, organizationId], references: [id, organizationId], onDelete: Cascade, onUpdate: Cascade)
  @@id([invitationId, projectId])
}

model JoinLink {
  orgRole String @default("member")  // always member (§6.2)
  @@unique([id, organizationId])
}

/// Website grants a join link gives on each redemption.
model JoinLinkGrant {
  joinLinkId     String
  organizationId String
  projectId      String
  role           String   // admin | member | viewer — CHECK
  joinLink JoinLink @relation(fields: [joinLinkId, organizationId], references: [id, organizationId], onDelete: Cascade, onUpdate: Cascade)
  project  Project  @relation(fields: [projectId, organizationId], references: [id, organizationId], onDelete: Cascade, onUpdate: Cascade)
  @@id([joinLinkId, projectId])
}

/// One redemption per link and person: makes "free retry" vs "new use" exact (§6.4).
model JoinLinkRedemption {
  joinLinkId String
  userId     String
  createdAt  DateTime @default(now())
  @@id([joinLinkId, userId])
}

/// Every URL handle an org has or had, in ONE unique namespace (current + aliases).
model OrganizationHandle {
  slug           String   @id
  organizationId String
  current        Boolean  // exactly one current per org (partial unique index)
  createdAt      DateTime @default(now())
}

/// Per-user dashboard preferences that are not auth state.
model UserPreference {
  userId             String  @id
  lastOrganizationId String?           // landing org; validated on read, never trusted
  recentProjectIds   String[]          // switcher "Recent" (§5.4.1), filtered by access on read
  notifications      Json    @default("{}")   // personal email prefs (§5.4.4)
  updatedAt          DateTime @updatedAt
}

model Notification {
  organizationId String?   // only for org events (member joined the org, billing…)
  // projectId stays for website events; their org is derived at read time
}
```

Invariants enforced **by the database**, not only by code:

1. A grant (site, invitation, join link) always lives in the same org as its
   website **and** its parent (composite FKs on both sides). FK constraints are
   `DEFERRABLE INITIALLY IMMEDIATE`: normal statements check immediately; only
   the merge script defers them (§10.2). A FK is integrity, not authorization:
   every submitted project id is still checked against the path org and the
   actor's scope, with 404 first.
2. Removing someone from the org deletes all their grants (cascade on the
   `Member` FK). Deleting a website deletes its grants, invitation grants and
   join-link grants; an invitation or join link left with no grant is then
   cancelled/revoked by the same operation (a website link never silently
   turns into an org-only admission).
3. Role columns have `CHECK` constraints; one `orgRole = owner` per org
   (partial unique index); one current handle per org.
4. Deleting an org with websites is impossible (`onDelete: Restrict`); org
   deletion erases each website first behind the deletion fence (§6.12).
   **PR 1 kept `Cascade`** (Restrict from PR 2) because the previous release deletes the org and
   relies on it removing the website (§10.1, rollback); until the contract PR
   the rule is enforced in application code: new code deletes an org only
   with `projects: { none: {} }` in the same statement.
5. `Project.dataTenantId` is non-null, unique, never reused, and an update
   trigger rejects any change.
6. Handles: every slug an org ever had is a row of `OrganizationHandle`, so a
   new org can never take an old alias. Normalisation: `slugify(name)`; if it
   is empty (e.g. an Arabic-only name) → `org-<6 chars of id>`; max 48 chars
   before the `-2`, `-3`… suffix; reserved words (`new`, `settings`, `welcome`,
   `o`, …) refused. Backfill keeps every existing valid slug and assigns the
   rest in `createdAt, id` order. `Organization.slug` mirrors the current
   handle. Aliases are followed only after authorization (members only).

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
of the 1:1); new websites → a fresh id **from PR 2 on**. In PR 1, where every
website is still created with its own org, new websites also get
`dataTenantId = organizationId`, so a rollback's readers (by
`organizationId`) and workers see the same tenant (§10.1). Rolling back from
PR 2 lands on PR 1, which already reads `dataTenantId`. Every reader/writer of those facts
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
| Remove someone from the org | ✓ | ✓ (anyone but the Owner; Admins can remove Admins, as today) | — |
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

"Add people" opens one dialog with a single input and a role select (Editor
by default); what it can find and do is §6.5. The pending list shows only
invitations that grant **this** website, and only this website's part of them
(email, role here, expiry, inviter); a site Admin can "Remove from this
invitation" (drops this website's grant; an invitation left with no grant is
cancelled). Copy link is allowed — only the invited address can accept.
Cancelling an invitation as a whole, or seeing its other websites, is for org
Owner/Admins on the org Members page (review #14).

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
  old one in the `OrganizationHandle` registry (§3), and `/app/o/<old>` redirects (only for
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
| **Account** (`/app/settings`, user menu; no org chrome — the shell shows a plain "Account" header and a "Back to <last org>" link) | Profile, email, sign-in methods, sessions/devices, appearance and interface language, **personal email notifications**, personal AI assistant keys overview, "Delete account" — refused while you own **any** organization, even one
where you are alone: the dialog lists them with "Transfer ownership" /
"Delete organization" links. Only then is the account deleted, which removes
your non-owner memberships through the normal removal operation (review #17). |
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
(`POST /app/invitations/:id/accept`); better-auth's is closed, so no path can
create a `Member` without applying the grants.

**One admission operation** serves invitations and join links (review #3, #4,
#5). In one transaction it:

1. locks, in this order, the org row, the issuer's `User` + `Member` rows, the
   accepting `User` row (so a concurrent suspension, deletion, removal or
   demotion of either side serialises with the admission);
2. re-checks the accepting account: exists, not banned, not suspended, email
   verified, and (invitations) normalised email equal to the invitation's;
3. re-checks the invitation: `pending`, not expired, claimed with a
   conditional update (`status pending → accepted`) so it can be used once;
4. re-checks the **issuer's current authority for every grant and the org
   role**: org Owner/Admin, or site Admin of each granted website (and org
   Owner/Admin for an org-Admin invitation). If any part is no longer
   grantable the **whole** admission is refused ("This invitation is no longer
   valid — ask for a new one"); nothing partial is applied;
5. applies the transition table (§6.3.1) and returns the exact landing target.

An issuer's removal or demotion also cancels their outstanding invitations
whose scope they can no longer grant (same rule as join links), so the
invitation list stays truthful; re-promotion never reactivates them.

| Case | What the person sees / what happens |
| --- | --- |
| Signed in, email matches, verified | "Join <Org>" card listing the access (org role; websites with roles) → Accept → admission → land (§6.3.2). |
| Signed in, different email | "This invitation is for a…@x.com. You're signed in as b…@y.com." [Switch account] (signs out, keeps the invitation as the pending destination, returns here). No accept button. |
| Signed out, account exists | Sign in (email OTP / Google) with the email prefilled → back here → Accept. |
| Signed out, no account | Sign up (email prefilled, OTP verifies it) → no starter organization (pending invitation) → back here → Accept. If the invitation became invalid meanwhile → `/app/welcome` with the "no access yet" wording. |
| Already a member | Transition table; "You're already in <Org>" + what changed → Open. |
| Issuer lost authority | "This invitation is no longer valid. Ask <inviter> or an admin of <Org> for a new one." |
| Expired | "This invitation expired. Ask <inviter> for a new one." |
| Revoked / unknown id | One "This invitation isn't valid" state (no oracle). |
| Already accepted | "Already used." "Open <Org>" only if the viewer is **currently** a member. |
| Suspended/banned account | Sign-in itself is refused (existing rules). |

#### 6.3.1 Existing role × invitation (applies to join links too)

| Current state | Invitation: org Member + grants | Invitation: org Admin |
| --- | --- | --- |
| Not a member | `orgRole = member` + grants | `orgRole = admin` |
| Org Member | grants added; an existing grant is upgraded, never downgraded; unrelated grants untouched | promoted to Admin (dormant grants kept); the card says "You'll become an Admin of <Org>" before Accept |
| Org Admin / Owner | grants stored dormant (no demotion); "You already have access to every website" | no change |

Accepting never marks other invitations as used; a join never consumes an
invitation.

#### 6.3.2 Landing and bootstrap

- Landing: exactly one website accessible in that org → its Overview;
  otherwise the org's Websites page. The org becomes the last org.
- **Bootstrap-owner invitations** (platform staff creating a customer org):
  `kind = bootstrap_owner`. Accepting claims the invitation and asserts, under
  the org lock, that the org has **no** owner; the person becomes the Owner
  (the partial unique index is the backstop against two concurrent accepts).
  A bootstrap invitation for an org that already has an Owner is invalid. The
  issuer check is "platform admin at issue time" (staff are not org members).

### 6.4 Join through a link — every case

`/join/:token` shows: org name, the websites and roles it grants, domain rule.
Redemption uses the admission operation (§6.3) with the link's creator as the
issuer, plus:

- every branch checks verified email, domain rule, current token hash,
  expiry, revocation, creator authority and capacity — including for people
  who are already org members (review #5);
- a **use** is counted whenever the link gives the person any new or upgraded
  permission (org membership or a website grant); a repeat by the same person
  that changes nothing is free (`JoinLinkRedemption(link, user)` records it);
- capacity is taken with the existing atomic conditional update.

| Case | Behaviour |
| --- | --- |
| Signed in, verified, domain ok, link usable | Join → admission → land (§6.3.2). |
| Already has everything the link grants | "You already have this access" → land; no use counted. |
| Org Member without these grants | Grants added, **one use counted**. |
| Signed out | Sign in / sign up; the token rides in the short-lived cookie as today; sign-up skips the starter organization only for a link that would admit this address → back → Join. |
| Unverified email | "Verify your email first" (OTP flow). |
| Wrong domain | "Only @x.com addresses can join with this link." |
| Revoked / expired / used up / creator lost authority / unknown | One "This link is not valid" state. |

### 6.5 Add an existing org member to a website

Website → Members → Add people → type an email or name. What a **site Admin**
can find is limited to people already visible to them: members of any website
they administer, matched by name/email prefix; anyone else only by **exact**
email (review #13). An exact match that is an org member → "Add to <website>"
(role select). An org Owner/Admin → "Already has access via organization"
(nothing written). No match → invitation to the org scoped to this website.
Org Owner/Admins search the whole org roster. The grant is upgrade-only if one
exists.

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
deleted ("3 websites, 412 pages") → type the org name. Then (review #16):

1. Under the org lock: set `deletionStartedAt`, store the fixed website
   manifest, revoke invitations and join links. From here every org
   mutation, admission, website creation, publish/write and merge refuses
   the org; members see "This organization is being deleted".
2. A durable job erases each website of the manifest with the website
   erasure (its own fence per website), outside any long transaction, and is
   resumable from where it stopped.
3. When all are gone: delete members, plan, handles, the org.

The Owner authorises the start; the job continues under that authorisation
even if the Owner's session ends.

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
- better-auth organization plugin: **every `/organization/*` path is
  disabled** (an explicit allowlist test fails if a plugin upgrade adds one).
  Even read endpoints answer differently for "unknown" and "not a member"
  (`get-organization`, `set-active`), which would turn slugs into an existence
  oracle (review #11). The admin support flow stops calling `set-active`
  (nothing reads the active org any more). The tables and server-side helpers
  stay; the `afterCreateOrganization` starter hook goes.
- Account state (review #4): one `assertUsableAccount(user)` — exists, not
  banned, not suspended — used by session guards, API-key and MCP actor
  resolution, `SiteMemberSession` revalidation and admissions (which also
  require a verified email). Today MCP checks only `suspendedAt`; this makes
  every path check both.
- Notifications are classified by resource and the capability needed to see
  them (review #19): website events (deploys, imports, a person added to the
  website) need current access to that website; org events (someone joined
  the org, billing) need current org Owner/Admin. Recipients are computed per
  event: a site Admin gets a payload about **their** website only (never the
  other websites of a multi-website admission), linking to the website
  Members tab; org Owner/Admins get the org payload linking to org Members.
  The inbox filters by the same rule **before** pagination and counts; legacy
  rows without a project are shown only to users who are still org
  Owner/Admin of an org they belonged to, else hidden. Queued emails
  re-check the recipient's access at send time.
- Usage (review #20): two DTOs. **Website usage** (any role on the website):
  that website's pages, storage, traffic, AI usage — no plan, no seats, no
  limits. **Org usage & billing** (org Owner/Admin): plan, limits, seats
  computed once, totals = per-measure sums over the websites' partitions,
  with "incomplete" propagated if any website's data is pending or
  unavailable (never counted as zero).
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
  `Project → Organization` becomes `onDelete: Restrict` in the contract PR, so
  no org delete can cascade past website erasure; until then the
  `projects: { none: {} }` predicate on every new-code org delete is the fence.
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

Two steps that are deliberately separate:

1. **PR 1's Prisma migration** — *expand only*. It adds tables/columns and
   backfills them; it **changes no value the current code reads**. No org is
   merged.
2. **The merge-by-owner script** — operator-run, dry-run first, after PRs 1–3
   are all deployed (the multi-org UI must exist before anyone ends up in a
   merged org).

### 10.1 Expand migration (PR 1)

Why expand-only (review #1): a deploy can run old and new code against the
same database for a while (a rolling container replacement, a worker or the
admin app updated later, a browser holding the old bundle). If the
migration rewrote `Member.role` (e.g. Viewer → `member`), old code would read
that as Editor and allow writes. So legacy columns keep their meaning and the
new model lives in new columns/tables that old code ignores:

| Legacy (unchanged, read by old code) | New (read only by new code) |
| --- | --- |
| `Member.role` (`owner/admin/member/viewer` = site role in a 1:1 org) | `Member.orgRole` (`owner/admin/member`) + `ProjectMember` grants |
| `Invitation.role` | `Invitation.kind` (`member` / `bootstrap_owner`), `Invitation.orgRole`, `InvitationGrant` |
| `JoinLink.role` | `JoinLink.orgRole` (always `member`), `JoinLinkGrant` |
| `OrganizationGitWebhookSecret`, `metadata.git`, `metadata.integrations` | `ProjectGitWebhookSecret`, `ProjectGitSettings`, `ProjectLegacySettings` (server-only) |
| `UsageStorageMarker/UsageIngestCheckpoint.organizationId` | `…partitionId` (= `Project.dataTenantId`), FK to the project, not the org |

Backfill, for every org with exactly one website P (current data has no other
case with a website):

| Legacy `Member.role` | `orgRole` | Grant on P |
| --- | --- | --- |
| owner (the earliest, if several — see below) | owner | — (implicit) |
| admin | member | admin |
| member | member | member (Editor) |
| viewer | member | viewer |
| any other / null | member | — (fail closed, reported) |

- Pending invitations: `kind = member`, `orgRole = member`,
  `InvitationGrant(P, legacy role)`. Platform bootstrap invitations
  (`role = owner`): `kind = bootstrap_owner`, no grants (§6.3.2).
- Join links: `orgRole = member`, `JoinLinkGrant(P, legacy role)`.
- Orgs with **zero websites**: every non-owner gets `orgRole = member` —
  including legacy Admins (no automatic org Admins, review #9). Their pending
  invitations and join links are revoked (nothing to grant).
- **Exceptional orgs are quarantined, not guessed** (review #9): an org with
  several owners keeps the earliest as `orgRole = owner` and the others as
  `member` + Admin grant (a demotion, never an expansion); an org with no owner
  gets no owner and is flagged `needsRepair` — org-level mutations are refused
  there until platform staff repair it through the bootstrap flow. All such
  orgs are listed in the migration log and the dry-run report.
- Suspended/banned users keep their rows as converted; they stay locked out by
  the account-state checks (§7). Deleted users have no rows (cascade today).
- `Project.dataTenantId = organizationId` for every website; a unique,
  non-null, immutable column (an update trigger rejects changes).
- `Organization.slug`/handles backfilled (§3, review #23).
- `UserPreference.notifications` backfilled (§5.4.4).
- Partial unique index: one `orgRole = owner` per org.

New code writes the legacy columns too, with the **least** privilege they can
express under the old meaning (owner→`owner`, admin→`admin`, member→`viewer`;
links/invites: legacy role `viewer`), so a brief overlap or a rollback can
never hand an old server more than the new model grants.

**Cutover:** stop-then-start for this release (maintenance window of a few
minutes; the deploy runbook says so), and the expand-only migration is the
defence in depth if anything old keeps running. **Rollback:** redeploying the
previous image is safe until the first organization holds two websites or the
merge runs; after that, roll forward only.

#### Rollback compatibility (merge council on #415)

The rule is absolute: **after a rollback, the previous release must never
grant more than the new model.** Each case below has a regression test
(`rollback-safety.postgres.test.ts`) and a rollback step in the old-release
harness (`scripts/legacy-schema-compat.mjs`: new code acts, the previous
release runs `legacy-rollback-scenario.fixture`, new code re-reads).

1. **Legacy mirror on change.** Every new-code change of a member's grants
   (site role change, site removal, org access replacement, org Admin →
   member) runs `syncLegacyMembership` in the same transaction:
   - org `member` with grants: `Member.role` becomes the **lower** of its
     current legacy role and its lowest grant. A grant never raises the legacy
     role (a rollback can only under-grant); a demotion lowers it at once
     (legacy Admin demoted to Viewer → `viewer`).
   - org `member` with **zero** grants: **PR 1** deleted the `Member` row
     and refused (409) every other way to reach zero grants (an org-member
     invitation with no website, an access replacement with no website, an
     org Admin → member demotion with no website), because the
     pre-organizations release treats any `Member` row as access.
     **From PR 3 on** an org member without websites is legitimate (§5, §6):
     the rollback target is PR 1/PR 2, which read `orgRole` + grants (no
     grant → 404 on every website), so the row grants nothing there. PR 3
     therefore allows zero grants on invitation, access replacement and
     demotion, keeps the `Member` row when the last grant goes (removal from
     the organization stays an explicit action, §6.7), and mirrors the
     legacy `Member.role` down to `viewer`, the least privilege. Rolling back
     past PR 1 was already unsupported once PR 2 ran (below).
   - The UPDATE sets `role` and `orgRole` together, so the legacy-writer
     triggers treat it as an explicit new-model write and leave grants alone.
   - Org Owner/Admin rows keep the explicit `owner`/`admin` mirror (old
     `admin` ⊆ new org Admin).
2. **Website deletion is an org action** (§4.2). `DELETE /projects/:id`
   requires the org Owner/Admin role (`requireProjectOrgRole`); a site-only
   Admin gets 403, an outsider 404.
3. **Org settings are authorized by org role.** The website settings PATCH
   (and the legacy `/workspace` PATCH) are guarded by the website Admin role;
   the org fields in them (`plan`, `notifications`) additionally need the org
   Owner/Admin role, checked before any write (403, nothing changed).
4. **New websites share the org partition in PR 1.** `createProject`, the
   platform-created site and the sign-up starter site set
   `dataTenantId = organizationId` explicitly; PR 2 switches new websites to
   an independent id.
5. **`project → organization` stays `ON DELETE CASCADE` in PR 1.** The
   previous release's `eraseProjectOrganization` erases ClickHouse data,
   queues search deletion, then deletes the org and expects the website to go
   with it; `Restrict` would leave a live website with its data erased.
   `Restrict` moves to the contract migration; meanwhile every new-code org
   delete carries `projects: { none: {} }` (the erasure fence).

Harness rollback steps (all four must pass before a deploy):

| Step | New release does | Previous release must see |
| --- | --- | --- |
| Demote, then roll back | legacy Admin → Viewer | role `viewer`; cannot edit or administer |
| Remove from website, then roll back | legacy Admin removed | no `Member` row; site not listed; 404 (PR 1 deploy only; from PR 3 the row stays with legacy `viewer` and no grant, which PR 1/PR 2 read as 404) |
| Create a website, then roll back | `createProject` | owner access; `dataTenantId = organizationId` |
| Delete a website, then roll back | — (old code deletes) | site **and** org gone; nothing half-erased |

Because the FK is Cascade again, the previous release's own suites no longer
need the cleanup-only adapter (`--cleanup-adapter`) to tear down.

**PR 3 (done):** org members may hold zero websites (invite with "None yet",
access replacement to none, demotion to none); removing someone's last
website grant keeps their `Member` row with legacy role `viewer`; the 404
invariant is unchanged (no grant → website 404). `rollback-safety.postgres.test.ts`
asserts all three paths and the 404, and `organization-people.postgres.test.ts`
covers the invitations list, resend and last-grant removal.

**PR 2 (done):** new websites get an independent `dataTenantId` (the Prisma
cuid default; `createProject`, the platform-created and starter sites no
longer pass the org id), and migration `20261111120000_project_organization_restrict`
sets `project → organization` to `ON DELETE RESTRICT`. The rollback target of
PR 2 is PR 1, which reads `dataTenantId` and erases each website before its org,
so both are safe there. The `8a3ce217` harness above applies only to the PR 1
deploy; rolling back past PR 1 is unsupported once PR 2 has run. The **contract** migration
(`Member.role := orgRole`, drop legacy tables/columns) is a later PR once
merges are verified.

**Decision — no automatic org Admins** (kept from the first draft, confirmed by
review): org Admin implies billing, the whole roster and every future
website, which nobody but the owner held across websites before. The report
lists people who were Admin on every website of an owner so the owner can
promote them deliberately.

### 10.2 Merge per owner (operator-run script)

`pnpm --filter @nibleaf/server org:merge -- plan | apply <planFile> | verify <runId> | restore <runId>`

**Plan** (read-only): for every owner `U` of more than one org (orgs flagged
`needsRepair` or being deleted are excluded):

1. Survivor: U's owned org with a website, oldest `createdAt`, then lowest id.
   Reason recorded.
2. Name (master's rule): if exactly one org of the group has a name that is
   not the default pattern ("<First>'s workspace" / "My workspace"), use that
   name; otherwise "<Owner first name>'s organization" (AR «مؤسسة <الاسم>»;
   no first name → "My organization"). Handle: the **oldest valid** slug of the
   group becomes current; every other handle of the group (current and
   aliases) becomes an alias. The report shows the chosen name and handle; the
   owner can rename later.
3. Plans: the group merges only if every org has the **same** plan id, status
   and expiry. Anything else is a conflict: the plan file must carry an
   explicit per-group decision (`plan: <planId>` chosen by a human) or the
   group is skipped (review #22). No automatic "highest plan" rule.
4. Provider receipts: a group with **pending** `UsageProviderCheckpoint` rows
   is skipped until they are drained; accepted ones are never touched (review
   #21).
5. Per person: the exact before/after permission sets (org role + every
   website role) — the plan **fails** if any person gains anything (review
   #25).
6. Unknown `metadata` keys: listed by name with a fingerprint (never values);
   a group with an unclassified key that differs between its orgs is skipped
   (review #12).
7. Output: a plan file with a **digest of every input row** of each group.

**Apply** (`apply <planFile>`), one transaction per group:

1. Take the run's advisory lock (one run at a time); lock every org of the
   group `FOR UPDATE` in id order; re-read; if the group's input digest
   differs from the plan (ownership transferred, grant changed, new Admin,
   website added/deleted, deletion started), **skip the group** and report it
   (review #8).
2. `SET CONSTRAINTS ALL DEFERRED` (the grant FKs are declared `DEFERRABLE
   INITIALLY IMMEDIATE` in the PR 1 migration; review #7). Order:
   a. upsert a survivor `Member` for every person of every source org
      (`orgRole = member`; `U` stays owner);
   b. move websites (`project.organizationId`), which re-points their grants
      (`ProjectMember.organizationId` updated in the same statement batch);
   c. move invitations and join links with their grant rows (ids and token
      hashes unchanged, so emailed and shared links keep working);
   d. merge handles into the survivor's registry;
   e. delete source members, then source orgs (their plan rows, metadata);
      `UsageStorageMarker`/`UsageIngestCheckpoint` hang off the project
      partition now, so nothing usage-related cascades (review #15).
3. Recompute every person's permission set and compare with the plan's
   after-set; any difference aborts the group's transaction.
4. Write the journal (below) in the same transaction.

**Journal and restore** (review #2): `org_merge_journal(run_id, seq bigserial,
group_key, table, row_id, before jsonb, after jsonb)`. It holds no secrets
(the merge touches no secret-bearing rows; they moved to the website in
PR 1). `restore <runId>` is an **offline** operation (maintenance window, app
stopped): for each group, in reverse `seq`, it first checks that every row's
current state equals its journalled `after` image; any divergence (a grant
removed since, a new website, a new invitation) **aborts that group** with a
report instead of resurrecting revoked access or discarding new work. The
pg_dump taken before `apply` is the last resort for anything restore refuses.

`verify <runId>`: re-runs the permission comparison against live data and the
404 checks (§10.5) for every merged group.

### 10.3 Org-scoped data: move or merge

PR 1 moves every per-website value off the organization (copied exactly,
never rotated), so the merge never has to choose between two sites' values.

| Data (today on the one-site org) | Decision | When |
| --- | --- | --- |
| `metadata.git` | **Copy** to `ProjectGitSettings`; new code reads only that | PR 1 |
| `OrganizationGitWebhookSecret` (+ legacy `metadata.git.webhookSecret`) | **Copy** to `ProjectGitWebhookSecret(projectId)`, exact value | PR 1 |
| `metadata.integrations` and every other non-allowlisted key | **Copy** to server-only `ProjectLegacySettings` (per original website); org DTOs and auth responses return only allowlisted org fields (review #12) | PR 1 |
| `metadata.notifications` | Personal toggles → `UserPreference.notifications` (off only if off in every org the user is in); `member_invited` → org "send invitation emails" (off only if off in every merged org) | PR 1 / merge |
| `OrganizationUsagePlan`, `metadata.plan`/`entitlements` | **Org**; merge only when identical or with an explicit human decision (§10.2) | merge |
| `UsageStorageMarker`, `UsageIngestCheckpoint` | **Website partition**: keyed by `partitionId = Project.dataTenantId`, FK to Project (§3, review #15) | PR 1 |
| `UsageProviderCheckpoint` | Keeps `organizationId` as **historical source partition** (never rewritten); new nullable `projectId` + `billingOrganizationId` for new rows; pending rows block a merge (§10.2) | PR 1 |
| ClickHouse facts, sealed archives, queued jobs, hash scopes, tombstones | **Unchanged**, keyed by `dataTenantId` (§3) | — |
| Redis draft-AI quota (per org per day) | **Org** budget. The merge sums the day's counters of the group into the survivor's key (review #22) | merge |
| Editor seats | **Org DTO only**: distinct users who are Owner/Admin or hold any Admin/Editor grant, banned/suspended excluded; computed once per org, never per website (review #20) | PR 1 |
| `Organization` name/handles/logo | **Org**; §10.2 | merge |
| `Member`, `Invitation`, `JoinLink(+Use)` | §10.1 / §10.2 | PR 1 / merge |
| `IntegrationAuditEvent.organizationId`, `PlatformEvent` metadata | **Historical provenance**, never rewritten | — |
| `ApiKey`, `McpOAuthGrant`, MCP audit/idempotency, `ProjectIntegration`, AI settings in `Project.config`, `GitConnection` and descendants, readers, content, assets, domains, deployments, exports | Already website-owned; only access checks change (§7) | PR 1 |
| `Notification` | Website events: org derived from `projectId` at read time (no backfill that could point at a deleted org). Org events: new `organizationId`, re-pointed by the merge (review #19) | PR 1 / merge |

### 10.4 Dry-run (plan) report, per owner

```
Owner sara@example.com (user_123)                    group digest 9f2c…
  survivor org_A "Sara's workspace" → "Sara's organization"  (oldest with a website)
  merges   org_B "API Docs" (website: api-docs)  handles: api-docs → alias
  plan     free = free  ✓          provider receipts: none pending ✓
  people   5 → 4 org members (1 shared)
    lina@…  before: docs=admin | api-docs=editor     after: same ✓
    omar@…  before: api-docs=admin                    after: same ✓   (Admin on every website: promotion candidate)
  invitations 2 moved (grants kept) · join links 1 moved (3 uses kept)
  metadata keys: notifications, git(moved), integrations(moved) · unknown: none
  notifications: member_invited on/on → on
  result: APPLY                                     (or SKIP: <reason>)
```

Plus a global section: quarantined orgs (`needsRepair`, multi-owner),
bootstrap invitations pending, orgs with zero websites, users referenced but
missing, every unknown metadata key with counts.

### 10.5 Tests (seed)

The seed covers: several owners (1, 2 and 3 websites); a person shared by two
owners with different roles; admins/editors/viewers; a person in both
survivor and source; pending invitations (incl. multi-grant and bootstrap)
and join links with uses on source orgs; API keys, Git connections with
one-way webhook secrets, MCP OAuth grants, readers/audiences; equal plans,
differing plans; zero-website orgs with an Admin and a Viewer; a multi-owner
and an ownerless org; banned, suspended and deleted principals; unknown
metadata keys; pending usage receipts; queued analytics jobs for a source
org's website.

Assertions: no person gains any permission (machine-checked sets); every API
key, Git webhook (signature), preview and OAuth grant keeps working; invitation
and join URLs keep working; queued jobs complete after the merge; erasure of a
merged website removes its old-partition facts; plan is pure (no writes);
`apply` twice = once; drift between plan and apply skips the group;
concurrent accept/remove, demote/join, delete-website/grant and
merge/transfer serialize correctly; restore right after apply returns the
exact rows; restore after an intervening grant removal or new website aborts
that group.

### 10.6 Production

1. Deploy PR 1 with the stop-then-start cutover; `pg_dump` **before** it, and
   verify the dump restores (review #1). Users see no change (1:1 orgs).
2. In **one window**: deploy PRs 2 and 3 together, `pg_dump`, `org:merge plan`
   through the audit thread's deploy path, review the report (JOODPMS first),
   `apply <planFile>` right after review, `verify <runId>`, browser spot-check.
   Users never see a switcher full of one-site orgs. PR 2's UI must still look
   right for 1:1 orgs (one org per website, named as today) for the minutes
   before the merge and for any group the plan skips.
3. Later PR: contract migration.

The feature thread never runs any of this against production.

## 11. PR plan (merge order; each works alone)

Each PR is deployable on its own and must work with the previous browser
bundle during the cutover (review #18).

1. **Data model + server authorization + admissions + merge script + tests.**
   Expand migration; `resolveSiteAccess` on every surface; org APIs (by id);
   better-auth `/organization/*` closed; transactional admissions (invite
   accept, join) **with their current pages switched to the new endpoints**,
   so accept/join keep working; per-website data off the org; partitions;
   erasure split; permission-matrix suite; merge script (plan/apply/verify/
   restore). Minimal UI so nothing regresses for 1:1 orgs: website Members
   tab reads grants and labels "via organization"; Plan/Notifications in
   website settings visible to org Owner/Admin with a pointer for others.
   Creating a website still creates a new org (unchanged behaviour) until PR 2
   ships the org UI.
2. **Organization shell.** `[Org ▾] / [Website ▾]` switcher, `/app/o/$slug/*`
   (Websites, Analytics, Members read view, Usage & billing, Settings),
   redirects, landing and `/app/welcome`, Account settings split, create
   website **inside** an org, create/delete/leave org, transfer ownership,
   notifications labelled by org.
3. **People.** Org Members (invite with website grants, access drawer,
   role changes, invitations, join links), website Members tab (add people,
   invite scoped to the website), accept/join pages for every case, emails,
   `docs/product/team.mdx` EN + AR, all locales.

Production merge runs only after PR 3 is deployed (§10.6).

## 12. Adversarial review (Sol, 2026-11-10) — resolutions

| # | Sev. | Finding | Resolution |
| --- | --- | --- | --- |
| 1 | critical | Rewriting roles in place lets old servers misread them during rollout | Expand-only migration, legacy columns untouched, least-privilege mirror writes, stop-then-start cutover, verified backup first (§10.1, §10.6) |
| 2 | high | Restore could resurrect revoked access / overwrite new work | Offline, `seq`-ordered restore that checks each row against its after-image and aborts a diverged group (§10.2) |
| 3 | high | Invitations didn't recheck the issuer's authority | Shared admission operation locks and rechecks issuer authority for every grant; issuer loss cancels their invitations (§6.3) |
| 4 | high | No account-state contract | `assertUsableAccount` everywhere + verified-email admission (§7, §6.3) |
| 5 | high | Existing org members bypass link limits | Use = any new/upgraded permission; every check on every branch; `JoinLinkRedemption` (§6.4) |
| 6 | high | Invitation/link grants not tied to their parent's org | Composite FKs to `Invitation(id, organizationId)` / `JoinLink(id, organizationId)` (§3) |
| 7 | high | Merge statement order fails immediate composite FKs | Deferrable FKs, explicit order, permission recheck before commit (§3, §10.2) |
| 8 | high | Live changes between plan and apply | Plan digest, ordered locks, re-read, skip drifted groups, run lock (§10.2) |
| 9 | high | Zero-website Admins stayed Admins; odd legacy orgs | Everyone non-owner → org Member; multi-owner/ownerless/unknown roles quarantined and reported (§10.1) |
| 10 | high | Bootstrap-owner invitations had no contract | `kind = bootstrap_owner`, no-owner assertion under lock, partial unique owner index (§3, §6.3.2) |
| 11 | high | better-auth reads leak org existence | All `/organization/*` closed, allowlist test (§7) |
| 12 | high | Unknown metadata could leak through org responses | Copied to server-only per-website storage; org DTOs allowlisted; merge skips unclassified conflicts (§10.3, §10.2) |
| 13 | high | Site admins could enumerate the org roster | Prefix search limited to people they already see; exact email otherwise (§6.5) |
| 14 | high | Shared invitations visible/cancellable beyond a site admin's scope | Site-scoped invitation view and "remove from this invitation"; whole-invite actions org-only (§5.3) |
| 15 | high | Contradictory partition rules; markers cascaded from org | §3 is the only rule; markers keyed by partition with FK to project (§3, §10.3) |
| 16 | high | Org deletion had no fence | `deletionStartedAt` + fixed manifest + resumable job (§6.12) |
| 17 | high | Account deletion could half-run | Refuse while owning any org (§5.4.4) |
| 18 | high | PRs weren't independently deployable | PR 1 ships working accept/join and 1:1-compatible behaviour; merge only after PR 3 (§11) |
| 19 | medium | Notification scope underspecified | Resource + capability classification, per-recipient payloads, filtered before counts, send-time recheck (§7) |
| 20 | medium | Org usage as a sum of site summaries double-counts seats and leaks billing | Separate website-usage and org-billing DTOs (§7) |
| 21 | medium | Provider receipt identity vs billing org | Historical partition kept; new `projectId`/`billingOrganizationId`; pending receipts block merge (§10.3) |
| 22 | medium | "Highest plan" isn't a defined policy; quota reset | Merge only identical plans or an explicit human choice; day quota summed (§10.2, §10.3) |
| 23 | medium | Slugs and aliases in separate namespaces; Arabic slugs empty | One `OrganizationHandle` registry; fallback and ordering rules (§3) |
| 24 | medium | Existing-member × invitation semantics | Transition table; nothing marks other invitations used (§6.3.1) |
| 25 | medium | Gate doesn't prove "no privilege expansion" | Machine-checked before/after permission sets, wider seed and concurrency tests (§10.2, §10.5) |
