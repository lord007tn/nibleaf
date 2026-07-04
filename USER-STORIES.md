# Plume / Midad — User Stories & Flows

> Open-source, self-hostable documentation platform (a Mintlify alternative). Authors write in Markdown/MDX, customize branding & navigation, publish versioned snapshots, and serve a fast, searchable, multi-language (LTR/RTL) docs site — all on their own infrastructure.

This document maps **who** uses the product, **what** they need (user stories), and **how** they move through it (flows), grounded in the actual routes, API, and publish pipeline. Diagrams are [Mermaid](https://mermaid.js.org/) and render on GitHub.

---

## 1. Personas

| Persona | Description | Primary goals |
|---|---|---|
| **Nour — Non-technical editor** | Marketing/product writer. Lives in the visual editor. | Write & edit pages without touching code; preview; publish. |
| **Karim — Technical writer / developer** | Comfortable with Markdown/MDX, Git, code blocks, API-reference components. | Author rich MDX, import from Git, manage versions, custom domain. |
| **Sara — Docs owner / admin** | Owns one or more doc sites. Manages branding, team, domains, plan. | Customize the brand, invite the team, connect a domain, watch analytics. |
| **Omar — Self-hoster / platform operator** | Runs the instance (Docker/Coolify). Has the platform admin role. | Deploy & operate the stack; manage users, sites, waitlist. |
| **Layla — Arabic reader (RTL)** | Consumes docs in Arabic on the published site. | Read correctly-mirrored RTL docs, switch language, search. |
| **Dev — API/SDK consumer** | Integrates via API keys. | Push content / read the site programmatically. |

---

## 2. System context

```mermaid
flowchart LR
    subgraph Clients
        Editor["Dashboard & Editor<br/>(app :4310)"]
        Marketing["Marketing site<br/>(www :4313)"]
        AdminUI["Admin panel<br/>(admin :4315)"]
        LiveSite["Published docs site<br/>(/sites/:id or custom domain)"]
    end

    API["API server (Hono)<br/>:4311 — /api/auth, /api/app, /api/public, /api/admin"]
    Worker["Worker<br/>BullMQ consumers"]

    subgraph Infra
        PG[("PostgreSQL<br/>Prisma")]
        Redis[("Dragonfly<br/>Redis / BullMQ")]
        S3[("S3-compatible<br/>object storage")]
        Search["Orama<br/>in-process search index"]
    end

    Editor -->|same-origin /api proxy| API
    Marketing --> API
    AdminUI --> API
    LiveSite --> API
    API --> PG
    API -->|enqueue jobs| Redis
    Worker -->|consume publish/search/email/analytics jobs| Redis
    Worker --> PG
    Worker --> S3
    API --> S3
    API --> Search
```

---

## 3. Site map (routes)

```mermaid
flowchart TD
    Root["/"] --> WWW["Marketing (www): / , /features, /pricing, /self-hosting, /cloud, /about"]

    subgraph Dashboard["Dashboard app (/app)"]
        Auth["(auth): sign-in, sign-up, forgot-password, reset-password, verify-email"]
        Invite["accept-invite/:invitationId"]
        Global["/app  — Your sites (global overview)"]
        GAnalytics["/app/analytics — workspace analytics"]
        GMembers["/app/members — account members"]
        GSettings["/app/settings — account settings"]
        Proj["/app/projects/:projectId — site overview"]
        PEditor["…/editor — authoring"]
        PPreview["…/preview — live preview"]
        PAnalytics["…/analytics — per-site analytics"]
        PSettings["…/settings — site settings"]
    end

    subgraph Live["Published site (/sites/:projectId)"]
        SIndex["index — first page"]
        SPage["/* — any page path"]
        SChangelog["/changelog — release history"]
    end

    subgraph Admin["Admin panel (:4315)"]
        AOverview["Overview"]
        AUsers["Users"]
        ASites["Sites"]
        AWaitlist["Waitlist"]
    end

    Global --> Proj --> PEditor
    Proj --> PPreview
    Proj --> PSettings
    Proj --> Live
```

---

## 4. Primary user journey (happy path)

```mermaid
journey
    title Docs owner: from sign-up to a live, customized site
    section Onboard
      Sign up: 4: Sara
      Land in starter "Documentation" site: 5: Sara
    section Author
      Edit pages in visual editor: 5: Sara, Nour
      Add pages and groups by drag-drop: 4: Nour
      Insert rich blocks and Mermaid: 4: Karim
    section Customize
      Brand the site (logo/colors/nav): 5: Sara
      Connect custom domain: 3: Sara
    section Publish
      Review changes diff: 5: Sara
      Publish (queue -> build -> live): 5: Sara
    section Grow
      Invite teammates: 4: Sara
      Watch analytics across sites: 4: Sara
```

---

## 5. Epics & user stories

Each epic lists stories in the form **"As a <persona>, I want <goal>, so that <value>"** with a flow diagram.

### Epic 1 — Account & Onboarding

**Stories**
- As a new user, I want to **sign up with name/email/password**, so that I get a workspace and can start writing.
- As a returning user, I want to **sign in**, so that I reach my sites.
- As a user who forgot my password, I want to **request a reset link** and **set a new password**.
- As a user on a public instance, I want to **verify my email** (when required).
- As an invited teammate, I want to **accept an invite** and join a site's workspace.
- As a signed-in user, I should **never see the sign-in page** (auto-redirect to `/app`); as a signed-out user, protected routes should **redirect me to sign-in**.

**Acceptance highlights**
- On sign-up, a workspace **and a starter "Documentation" site (5–6 pages) are provisioned** (unique slug — works for every user, not just the first).
- Single-site users are **auto-redirected into their sole project**; multi-site users see the **global "Your sites"** overview.

```mermaid
flowchart TD
    A["Visit /app"] --> B{Session valid?}
    B -- yes --> H{How many sites?}
    B -- no --> C["Show sign-in"]
    C --> D["Create one -> sign-up"]
    D --> E["Enter name, email, password"]
    E --> F["POST /api/auth/sign-up/email"]
    F --> G["Provision workspace + starter site<br/>(user.create hook)"]
    G --> H
    H -- exactly 1 --> I["Redirect into /app/projects/:id"]
    H -- 0 or 2+ --> J["/app — Your sites overview"]
    C --> K["Forgot password?"]
    K --> L["Email reset link (queued)"]
    L --> M["/reset-password -> set new password"]
    M --> C
```

**Sign-up sequence (with provisioning + email):**

```mermaid
sequenceDiagram
    actor U as New user
    participant App as App (:4310)
    participant API as API /api/auth
    participant DB as Postgres
    participant Q as BullMQ (email)
    participant W as Worker

    U->>App: Fill sign-up form
    App->>API: POST /sign-up/email
    API->>DB: Create user + session
    API-->>DB: user.create hook -> provisionWorkspace()
    Note over API,DB: Create org + membership (owner)<br/>+ starter "Documentation" site (unique slug)
    API->>Q: enqueue "new sign-in" email
    W->>Q: consume -> log/send (SMTP optional)
    API-->>App: 200 + session cookie
    App->>U: Redirect (sole site -> editor, else overview)
```

---

### Epic 2 — Workspace & Multi-site management

**Stories**
- As a docs owner, I want a **global overview of all my sites** with aggregated page views & unique visitors, so that I can see performance at a glance.
- As a docs owner, I want to **create a new documentation site** from the dashboard.
- As a docs owner with one site, I want to **land straight in it** without an extra click.
- As a docs owner, I want each site listed with **pages, deploys, and views**.

**Acceptance highlights**
- Global analytics aggregate **across all the user's sites** (each site is its own org; the overview spans every org the user belongs to).
- The "New project" dialog creates a site and drops the user into it.

```mermaid
flowchart TD
    A["/app — Your sites"] --> B["KPI cards: Projects, Pages, Page views, Unique visitors"]
    A --> C["Page-views chart across all sites (7/30/90 days)"]
    A --> D["Sites table: name, pages, deploys, views"]
    A --> E["+ New project"]
    E --> F["Dialog: name"]
    F --> G["POST /api/app/projects"]
    G --> H["New org + project + default language"]
    H --> I["Navigate into /app/projects/:id"]
    D -->|click row| I
```

---

### Epic 3 — Content authoring (the editor)

**Stories**
- As a non-technical editor, I want a **visual (WYSIWYG) editor** with a slash menu, so that I can write without Markdown syntax.
- As a technical writer, I want a **raw Markdown mode** and a **rendered preview**, so that I can round-trip content losslessly.
- As an author, I want to **organize pages into groups and reorder them via drag-and-drop**.
- As an author, I want to **insert rich blocks**: headings, lists, task lists, quotes, code blocks, callouts, cards, steps, tabs, accordions, frames, param/response fields, **Mermaid diagrams**, images, tables.
- As an author, I want to **add pages, set page settings** (icon, slug, SEO, layout mode, hidden), and **switch branches/versions**.
- As a reviewer, I want to **leave comments** anchored to content.
- As an author on RTL content, I want the editor content direction to **follow the page's language**.

**Acceptance highlights**
- Content is **Markdown end-to-end**; the TipTap editor round-trips Markdown (never persists ProseMirror JSON).
- Three modes: **Visual / Markdown / Preview**.

```mermaid
flowchart TD
    subgraph Editor["/app/projects/:id/editor"]
        Tree["Page tree (left): languages, groups, pages<br/>drag to reorder, + add, settings"]
        Modes["Mode toggle: Visual | Markdown | Preview"]
        Canvas["Editing canvas"]
        Branch["Branch/version switcher"]
        Rail["Comments / activity rail"]
        Pub["Publish"]
    end

    Tree -->|select page| Canvas
    Modes -->|Visual| V["WYSIWYG + slash menu (/)"]
    Modes -->|Markdown| M["Raw Markdown textarea"]
    Modes -->|Preview| P["Rendered MDX (as it will look live)"]
    V -->|type slash| Slash["Slash menu: heading, list, code,<br/>callout, card, steps, tabs, Mermaid, image, table…"]
    Canvas -->|autosave Markdown| DB[("page.content")]
    Pub --> PublishFlow["Publish pipeline (Epic 5)"]
```

**Content lifecycle (draft vs published):**

```mermaid
stateDiagram-v2
    [*] --> Draft: create page
    Draft --> Draft: edit (autosaved to DB)
    Draft --> Published: Publish (snapshot captured)
    Published --> Draft: edit again (diverges from live)
    Published --> Published: re-publish
    note right of Published
        Live site serves the latest READY
        deployment snapshot. Draft edits are
        not live until re-published.
        (Site chrome/branding IS live via overlay.)
    end note
```

---

### Epic 4 — Customization & Settings

**Stories**
- As a docs owner, I want to set **branding** (light/dark logo, favicon, logo link).
- As a docs owner, I want to control **styling** (primary color, theme default light/dark/system) and **typography**.
- As a docs owner, I want to configure the **navbar** (links, CTA) and **footer** (links, socials).
- As a docs owner, I want to add a **banner**, edit **SEO/metadata**, define **variables** and **redirects**, and tune **search**.
- As a docs owner, I want to set the **deployment name (subdomain)** and **connect a custom domain** (with DNS instructions + verification).
- As a docs owner, I want **analytics** (GA4 / Plausible) with validation and cookie-consent.
- As a docs owner, I want **languages** (add an Arabic/RTL language) and **versions**.
- As a docs owner, I want **exports**, **notifications**, **API keys**, **plan/usage/billing**, and a **danger zone** (delete requires typing the name).

**Acceptance highlights**
- Two surfaces: the editor's **Site settings panel** (Branding, Styling, Typography, Navbar, Footer, Banner, SEO, Search, Variables, Redirects) and the project **/settings** route (General, Custom domain, Authentication, Analytics, Add-ons, Git, Members, API keys, Plan, Usage, Billing, Notifications, Exports, Danger zone).
- **Chrome/branding config is applied to the live site immediately** (overlay); page content/structure still requires a re-publish.

```mermaid
flowchart LR
    subgraph SitePanel["Editor -> Settings (site config)"]
        Branding --> Styling --> Typography --> Navbar --> Footer --> Banner --> SEO --> Vars["Variables"] --> Redirects
    end
    subgraph ProjSettings["/app/projects/:id/settings"]
        General --> Domain["Custom domain"] --> AuthN["Authentication (public/private)"] --> Analytics --> Addons --> Git --> Members --> Keys["API keys"] --> Plan --> Danger["Danger zone"]
    end
    SitePanel -->|save| Cfg[("Project.config (live overlay)")]
    ProjSettings -->|save| Cfg
    Cfg -->|immediately| LiveChrome["Live site chrome/branding"]
```

**Custom-domain connect & verify:**

```mermaid
sequenceDiagram
    actor S as Docs owner
    participant App
    participant API as /api/app/.../domains
    participant DNS as DNS provider
    participant Edge as App edge (host resolver)

    S->>App: Add domain "docs.acme.com"
    App->>API: POST domain
    API-->>App: DNS records (CNAME -> your ingress, TXT verify token)
    S->>DNS: Create CNAME + TXT records
    S->>App: Click "Verify"
    App->>API: POST verify
    API->>DNS: resolveTxt(_midad.docs.acme.com)
    DNS-->>API: token
    API-->>App: verified = true
    Note over Edge: resolveDomainHost() maps the verified host -> project
```

---

### Epic 5 — Publishing

**Stories**
- As a docs owner, I want to **review a diff of changes** since the last version before publishing.
- As a docs owner, I want to **publish** and watch a **live progress pipeline** (Queued → Building snapshot → Indexing search → Live).
- As a docs owner, I want a **success toast with a link to the live site**.
- As a docs owner, I want to **roll back** to the previous version if something's wrong.
- As a reader, I want a **changelog** of releases.

**Acceptance highlights**
- Publish enqueues a job; the worker **builds an immutable snapshot** (`buildSnapshot`) with variables baked in, sets the deployment **READY**, and the search index is (re)built per (project, language, version).
- Deployment states: **PENDING → BUILDING → READY / FAILED**.

```mermaid
sequenceDiagram
    actor S as Docs owner
    participant App
    participant API as /api/app/.../deployments
    participant Q as BullMQ (publish)
    participant W as Worker
    participant DB as Postgres
    participant Search as Orama index

    S->>App: Click Publish (review diff)
    App->>API: POST deployments
    API->>DB: Deployment(status=PENDING)
    API->>Q: enqueue publish job
    App->>API: poll deployments (1.5s)
    W->>Q: consume job
    W->>DB: status=BUILDING
    W->>DB: buildSnapshot(project, pages) -> READY
    Note over W,Search: On first search request the index<br/>is built per (project, language, version)
    API-->>App: status=READY
    App->>S: "Published — your site is live" (+ View site)
```

**Deployment lifecycle & rollback:**

```mermaid
stateDiagram-v2
    [*] --> PENDING: Publish
    PENDING --> BUILDING: worker picks up
    BUILDING --> READY: snapshot ok
    BUILDING --> FAILED: error (shown in dialog)
    READY --> [*]
    FAILED --> PENDING: retry publish
    READY --> READY: new version supersedes
    state Rollback <<choice>>
    READY --> Rollback: Roll back
    Rollback --> READY: previous READY becomes live
```

---

### Epic 6 — Live documentation site (reader)

**Stories**
- As a reader, I want a **fast docs site** with a sidebar nav, breadcrumbs, table of contents, and prev/next.
- As a reader, I want **full-text + fuzzy search** with excerpts.
- As a reader, I want to **toggle light/dark theme** (persisted).
- As a reader, I want **rich content**: styled headings (not link-colored), callouts, cards, tabs, code with copy button + filename, Mermaid diagrams, images.
- As an Arabic reader, I want the site rendered **RTL** with correct mirroring; as any reader, I want to **switch language**.
- As a reader on mobile, I want a **hamburger nav drawer** (opening from the correct side per direction).
- As the owner, I want **pageviews/searches tracked** (with optional cookie consent).

```mermaid
flowchart TD
    V["Visitor opens /sites/:id or custom domain"] --> Shell["GET /api/public/sites/:id — shell (branding, nav, languages, versions)"]
    Shell --> Page["GET /:id/page?path=… — page + TOC + breadcrumbs + prev/next"]
    Page --> Render["Render MDX (headings, callouts, cards, code, Mermaid…)"]
    Render --> Track["POST /:id/events — pageview"]
    V --> Search["Search (⌘K) -> GET /:id/search"]
    V --> Theme["Toggle theme (light/dark, persisted)"]
    V --> Lang["Switch language (?lang=) -> RTL for Arabic"]
    V --> Mobile["Mobile: nav drawer — opens from start edge, right in RTL"]
    Shell --> SEO["sitemap.xml / robots.txt / hreflang alternates"]
```

**Reader page-render sequence:**

```mermaid
sequenceDiagram
    actor L as Reader
    participant Site as /sites/:id
    participant API as /api/public
    participant DB as Postgres

    L->>Site: Open page URL
    Site->>API: GET /sites/:id (shell)
    API->>DB: latest READY deployment snapshot (+ live config overlay)
    API-->>Site: project chrome, nav, languages
    Site->>API: GET /sites/:id/page?path=…&lang=…
    API-->>Site: page content, headings(TOC), prev/next, breadcrumbs
    Site->>L: Rendered docs (theme + direction applied)
    Site->>API: POST /sites/:id/events (pageview)
```

---

### Epic 7 — Team & Members

**Stories**
- As an owner/admin, I want to **invite teammates by email** with a role (member/admin/owner).
- As an owner, I want to **change roles**, **remove members**, and **revoke pending invitations**.
- As an owner, I want to **transfer ownership**.
- As an invitee, I want to **accept an invite** and be added to the site's workspace.

```mermaid
flowchart TD
    O["Owner: Members section"] --> Invite["Invite by email + role"]
    Invite --> Pending["Pending invitation (copy link / revoke)"]
    Pending --> Accept["Invitee -> /accept-invite/:id"]
    Accept --> Member["Joins org as member"]
    O --> Manage["Change role / remove member"]
    O --> Transfer["Transfer ownership (confirm)"]
```

---

### Epic 8 — Internationalization & RTL (Arabic)

**Stories**
- As an Arabic-speaking author, I want the **dashboard & editor UI in Arabic** with correct **RTL mirroring**.
- As an author, I want **English page content to stay LTR** even while the chrome is RTL (direction follows the page's language, not the UI).
- As a reader, I want the **published Arabic site** rendered RTL (nav, TOC, mobile drawer, consent).

```mermaid
flowchart LR
    Toggle["Language switch (EN / العربية)"] --> Locale["Store locale (midad.locale)"]
    Locale --> Dir["Set <html dir> + lang"]
    Dir -->|ar| RTL["RTL: mirrored layout, logical spacing (ms/me, start/end)"]
    Dir -->|en| LTR["LTR"]
    subgraph Content
        PageLang["Page/language direction"] --> ContentDir["Editor & live content direction (independent of UI)"]
    end
```

---

### Epic 9 — Platform administration (self-hoster)

**Stories**
- As the operator, I want to **sign in to the admin panel** (platform-admin role only).
- As the operator, I want an **overview** (users, admins, sites, deployments, waitlist, new users).
- As the operator, I want to **manage users** (grant/revoke platform admin).
- As the operator, I want to **see every site across all workspaces**.
- As the operator, I want to **view & export the cloud waitlist**.

```mermaid
flowchart TD
    Op["Operator -> :4315 sign-in"] --> Gate{Is platform admin?}
    Gate -- no --> Denied["Not authorized"]
    Gate -- yes --> Overview["Overview: platform stats"]
    Overview --> Users["Users: grant/revoke admin"]
    Overview --> Sites["Sites: all workspaces"]
    Overview --> Waitlist["Waitlist: view / export"]
```

---

### Epic 10 — Self-hosting & operations

**Stories**
- As an operator, I want to **run the whole stack with Docker Compose** (app, api, worker, Postgres, Dragonfly, S3).
- As an operator, I want **health checks** (`/health`) and a **worker jobs dashboard**.
- As an operator, I want **sane env defaults** and clear config (`.env.example`) — including all app origins in `TRUSTED_ORIGINS` and a self-host-safe custom-domain CNAME target.
- As an operator, I want an **upgrade routine** (migrate, restart, verify a publish).

```mermaid
flowchart LR
    Compose["docker compose up -d"] --> Stack["app + api + worker + www + admin"]
    Stack --> PG[("Postgres")]
    Stack --> DF[("Dragonfly")]
    Stack --> S3[("S3 / MinIO")]
    Ops["Operator"] --> Health["/health checks"]
    Ops --> Jobs["Worker /jobs dashboard"]
    Ops --> Upgrade["pull -> db:deploy -> restart -> verify publish"]
```

---

## 6. End-to-end: from zero to a live customized site

```mermaid
sequenceDiagram
    actor S as Sara (docs owner)
    participant App
    participant API
    participant W as Worker
    participant Live as Published site

    S->>App: Sign up
    App->>API: create user
    API-->>App: workspace + starter "Documentation" site
    S->>App: Edit pages (visual/markdown), add groups
    App->>API: autosave Markdown
    S->>App: Set logo, colors, navbar, footer (site settings)
    App->>API: save config (live overlay)
    S->>App: Add custom domain + verify DNS
    S->>App: Publish
    App->>API: POST deployment (PENDING)
    API->>W: enqueue publish
    W-->>API: snapshot READY
    App-->>S: "Live!" + link
    S->>Live: View site (search, TOC, theme, RTL if Arabic)
    S->>App: Invite teammates and watch analytics across sites
```

---

## 7. Coverage matrix (persona × capability)

| Capability | Nour (editor) | Karim (tech writer) | Sara (owner) | Omar (operator) | Layla (reader) | Dev (API) |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Sign up / in | ✅ | ✅ | ✅ | ✅ | — | — |
| Visual editor | ✅ | ✅ | ✅ | — | — | — |
| Markdown / MDX / Mermaid | ◐ | ✅ | ◐ | — | — | ✅ |
| Page tree / drag-drop | ✅ | ✅ | ✅ | — | — | — |
| Branding / styling | ◐ | ◐ | ✅ | — | — | — |
| Navbar / footer / SEO | — | ◐ | ✅ | — | — | — |
| Custom domain | — | ✅ | ✅ | ◐ | — | — |
| Languages / RTL | ◐ | ✅ | ✅ | — | ✅ (read) | — |
| Publish / rollback | ✅ | ✅ | ✅ | — | — | ◐ |
| Live site: search/TOC/theme | — | — | — | — | ✅ | — |
| Members / roles | — | — | ✅ | — | — | — |
| Analytics | ◐ | ◐ | ✅ | ◐ | — | — |
| Platform admin | — | — | — | ✅ | — | — |
| API keys / SDK | — | ✅ | ◐ | — | — | ✅ |

Legend: ✅ primary · ◐ occasional · — not applicable.

---

### Notes on scope (from dogfooding)

- **Live today:** all flows above are implemented and verified end-to-end (auth, multi-site dashboard + aggregated analytics, editor with Markdown round-trip, full settings/customization surface, publish pipeline with rollback, live site with search/TOC/theme/RTL, members, admin panel, self-host config).
- **Renderable but not yet visually *authorable* (planned):** Tooltip, Icon, ParamField/ResponseField attributes, code-block filename + language picker, callout-variant switcher — these render on the live site but need editor node-views to insert/edit inline (Mermaid + callout-note insertion are done).
- **Planned features:** custom CSS/JS/head injection; external-reader auth (shared-password / JWT / SSO) beyond member-only private sites.
