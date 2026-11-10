# Dashboard UI overhaul: audit, layout system, modules and data flow

Status: Phase A, reviewed once by Sol (gpt-6.1-sol, high) with its critique applied (§12). Owner of the work: the
`feat/ui-overhaul` thread. The master thread reviews and merges.

This document is the contract for the overhaul. Every PR in the series links here and must not contradict it. A change
of plan changes this file first.

## 0. Why and what

The owner, on 2026-11-10, looking at production Settings → Members: "look how the UI suck, I want a UI overhaul, better
modules structure, better data flow, put logic into things, and test on production." The master's production audit
(§3) widens this to every page, flow and journey.

**Quality bar:** dashboard settings at the level of Linear, Vercel or Mintlify:

- consistent, dense but calm, aligned to one grid;
- no stray scrollbars;
- no errors shown on untouched forms;
- no unlabeled icon buttons;
- every disabled control says why.

**Scope.** The overhaul covers everything in the dashboard except the parts owned by the Organizations thread:

- every site settings section body;
- the site Overview, site Analytics and the AI assistant page;
- dialogs and toasts, and the shared UI primitives;
- then the editor chrome (not the editor core);
- then the published reader theme.

The Organizations thread owns:

- the org shell and the org/website switcher;
- `/app/o/$orgSlug/*` and `/app/welcome`;
- people, members, invites, join links and accept-invite;
- the site settings nav file until its PR 2 merges.

**Files frozen until PR 2 (`feat/organizations-shell`) merges.** These are in PR 2's diff (`git diff --stat
origin/main...feat/organizations-shell -- apps/app`, 102 files):

- `layouts/*`;
- `routes/app/projects/$projectId/settings.tsx` and `routes/app/(dashboard)/*`;
- `hooks/api/{index,mutations,queries,query-keys,query-options,types}.ts`;
- `components/project-settings/{danger,members}-section.tsx`;
- `components/settings/{usage,notifications}-tab.tsx`;
- `scripts/check-bundle-budget.mjs`;
- the command palette, notifications popover and new-project dialog.

Until then, new code goes into new files. After the merge we merge `main` in (never rebase) and adopt.

## 1. Principles

1. **One layout system.** Every settings screen uses the same page header, content column, section rhythm and row
   pattern. Nothing hand-rolls a card (`rounded-xl border bg-card p-5`, about 150 occurrences today).
2. **Policy lives in models; components render.** Permissions, "why is this disabled", validation and meaningful
   derived state live in pure `model` modules with unit tests. JSX doesn't compare role strings or chain business
   conditions. Trivial view booleans (`isOpen`, `hasItems`) may stay in components; this rule is about policy, not
   ceremony.
3. **Server state lives in TanStack Query, form state in TanStack Form, and nowhere else.** No `useEffect` copies server
   data into `useState` (six screens do it today and wipe edits on refetch).
4. **One way to do each thing.** One confirm and one action dialog (today there are four confirm patterns), one status
   badge (eight local clones), one empty state, one copy button (four), one disabled-reason pattern (one correct site
   out of about 20).
5. **Accessible and bilingual by construction.** Landmarks, headings in order, a label on every control, logical
   properties (`ms-`/`me-`/`start`/`end`), and Arabic RTL in every PR.
6. **Small, reviewable PRs, each one fully done.** One area per PR, under 40 files where possible. Error states,
   keyboard behaviour, RTL and mobile are acceptance criteria for every PR (§10), not cleanup for later.

## 2. Ownership and sequencing

| Track | Owner | Depends on |
|---|---|---|
| B1a Design-system primitives | UI overhaul | none |
| B1b Form lifecycle + settings layout, General as reference | UI overhaul | B1a |
| B1c Site access model | UI overhaul | none (parallel with B1b) |
| Settings shell adoption (nav, landmarks, scroll) | UI overhaul | PR 2 merged; done right after |
| B2–B5 Site settings sections, by area | UI overhaul | B1b, B1c |
| B6 Overview, Analytics, AI assistant | UI overhaul | B1a, B1c |
| B7 Editor chrome | UI overhaul | B1a, production audit |
| B8 Published reader theme | UI overhaul | production audit, bundle budget |
| B9 Cross-cutting fixes from the production audit | UI overhaul | §3 |
| Members, invites, join links, org pages (PR 3) | Organizations | B1a/B1b (adopts the primitives) |

## 3. Production audit findings (from the master)

> Placeholder. The master is running a production audit in four areas: signed-out/onboarding,
> authoring/editor/settings, workspace/team/AI/billing, and reader-facing published docs. The consolidated findings
> (severity, screenshot, likely files) go here verbatim, and each one is mapped to a track in §2, or marked "Organizations
> thread" or "out of scope" with a reason.

| ID | Severity | Area | Finding | Likely files | Track | Status |
|---|---|---|---|---|---|---|
| | | | | | | |

## 4. Local audit (code and screens)

This audit covers the screens this thread owns. It comes from a static read of every section plus baseline screenshots
of the local app on 2026-11-10 (seeded demo site, 1440 px, light, EN). It does not repeat the production audit.

### 4.1 Bugs to fix outright

| Bug | Where | Fix in |
|---|---|---|
| Owner badge reads "Owner **?** via organization". A literal `" ? "` was meant to be "·". Still present on the PR 2 branch | `project-settings/members-section.tsx:285,290` | Organizations thread (PR 2/3 file). Handed off |
| `SaveBar` reports dirty when it isn't (`dirty ?? !disabled`), so the unsaved-changes guard fires on pristine forms. It also mounts a second `DirtyStateReporter` next to the form's own (navbar, SEO, search) | `project-settings/shared.tsx:400-428` | B1b |
| `saveConfigSection` resolves on failure, so callers can't tell success from error | `project-settings/shared.tsx:90-103` | B1b |
| Advanced access: a `useEffect` copies `data.jwt` into 7 `useState` on every refetch. Creating an audience wipes in-progress JWT edits | `visibility/advanced-access.tsx:84-93` | B2 |
| Authentication: a `useEffect` overwrites the unsaved access mode on every refetch | `authentication-section.tsx:52-54` | B2 |
| OpenAPI: same pattern (4 `useState` seeded in an effect) | `openapi-section.tsx:34-40` | B3 |
| Smart AI: `aria-describedby` points at a node that isn't rendered once saved | `smart-ai-section.tsx:399/417` | B4 |
| AI page: an inline `onChange` arrow resets the 350 ms search debounce on every render | `routes/…/ai.tsx:28` | B6 |
| Git webhook URL comes from `window.location.origin` in one place and `env.VITE_APP_URL` in another | `settings/git-tab.tsx:261` vs `git-workflow.tsx` | B3 |
| Git workflow submits English placeholder defaults (`docs@example.com`) | `settings/git-workflow.tsx:168-171` | B3 |
| SEO language override clears with `{config: null}`, relying on a server special case | `seo-section.tsx:123-133` | B5 |

### 4.2 The settings shell (screens)

- **Two scroll containers.** The settings route is `h-[calc(100vh-3.5rem)] overflow-hidden`, with the nav and the
  content each scrolling on their own, inside the project layout, which has its own sticky 48 px header. At 1440×900
  the nav's last item (Danger zone) is clipped at the bottom edge, and the window, the nav and the content each have
  their own scrollbar.
- **No column discipline.** The content column is `max-w-4xl` or `max-w-6xl` depending on the section, inside a
  `max-w-6xl mx-auto` wrapper. Inputs stretch to about 830 px (General: the Name field is as wide as a paragraph).
  Wide sections jump to about 1100 px.
- **Four header styles.** `SectionHeader` (h2, text-lg, rule below), `SettingsSection` (h2, font-medium, no rule),
  hand-built `h2 text-xl` cards (Plan, Usage), and `h3 text-[15px]` (Join links). The Git section has no page header at
  all, only a card titled "Connect GitHub".
- **Cards in cards**, up to three or four levels (Git: card → step cards → form card; Domain; Import; Integrations;
  Account; Add-ons; Usage).
- **Save button floats** at the bottom-right of the form, far from the fields it saves, with no "unsaved changes" state.
- **Disabled primary buttons with no reason** (Members "Invite", Git "Authorize GitHub", Exports, API keys, Smart AI,
  Import and others, about 20 in total).
- **Landmarks.** The page's skip target is a focusable generic `div#main-content tabIndex=-1`
  (`layouts/project.tsx:243`) that wraps all of the page text. There is no `<main>`, and the settings nav is a `<nav>`
  with no label. This is a PR 2 file; the master asked the Organizations thread to make it a `<main>` in PR 2.
- **Navigation.** Nav items are buttons calling `navigate()`, so they can't be middle-clicked or have their link
  copied.
- **Mobile.** The section picker is a full-width Select above the content (acceptable). Content gutters differ per page:
  overview `px-6`, analytics `px-4 sm:px-6`, AI `px-4 … xl:px-10`.

### 4.3 Repeated defects across sections (ranked)

1. Hand-written card class strings instead of a primitive: about 150 occurrences in 47 files. git-workflow has 19,
   theme 14.
2. Cards nested in cards: add-ons, domain, advanced-access, account, git, import, integrations, usage, theme.
3. Font sizes off the type scale (`text-[13px]`, `[12.5px]`, `[13.5px]`, `[15px]`…): about 90 sites, including
   inside the shared primitives themselves.
4. Controls disabled with no reason: about 20 sites.
5. Form state split between `useState` and TanStack Form, with dirtiness rebuilt by hand through `JSON.stringify`:
   16 sections.
6. Server data mirrored into local state through `useEffect` or setState during render: 6 sections.
7. Validation errors shown while typing, or with no touched check at all: analytics, general, account, api-keys,
   join-links, redirects, search. `FieldError` has no notion of "touched".
8. Validation reported only by a toast: styling, import, integrations, search (twice), advanced-access.
9. Generic error toasts instead of `friendlyErrorMessage`: six language-scope saves, add-ons, branding, danger.
10. Inline role and permission logic in JSX: members, danger, api-keys, connected-apps, overview, AI detail.
11. Button groups with `aria-pressed` acting as tabs or radios: 8 groups.
12. Repeated row buttons whose accessible names lack the object ("Remove" instead of "Remove docs.acme.com"):
    domain, join-links, languages, members, AI gaps, branding.
13. Inputs labelled only by a placeholder: navbar, advanced-access, add-ons privacy URL.
14. Preview components leak real `h2`/`h3` into the page outline: theme, typography.
15. Toggles wait for the round trip, and some disable every sibling while one write is pending (notifications, access
    requests, languages, add-ons). Whether each may be optimistic is decided per mutation (§8.2).

### 4.4 Overview, Analytics, AI assistant

- **Overview** (`routes/…/index.tsx`, 785 lines):
  - The page holds about 15 derived flags (`hasReadyDeployment`, `neverPublished`, `publishFailed`, `liveDomain`,
    `viewsDelta`, `canManageSettings`…) and inline `settingsAccess === 'admin'` checks.
  - It has six hand-built card styles.
  - "Publish anyway" is disabled with only a `title` to explain why.
  - Rows that non-admins can't open keep their hover and focus styles.
  - The publish nudge reads localStorage in an effect, so it pops in late.
- **Analytics:** the h1 and subtitle are copied in three places. The same loader is duplicated in six child routes,
  each with two casts. List cards have no error state. Fixed-width bar labels clip long and Arabic labels.
- **AI assistant:**
  - The tabs have no panels.
  - The conversation rows are clickable `<tr>`s that also contain a link, giving two tab stops per row.
  - The detail sheet re-derives the admin check itself.
  - Citations are bare numbers.
  - It has four stat-tile variants.

## 5. Target layout system

### 5.1 Page anatomy (settings)

```
┌ project layout: sticky 48px header (org thread) ─────────────────────────────────┐
│ ┌ settings nav ─┐ ┌ <main> content column (start-aligned, max 760 px) ─────────┐ │
│ │ sticky,       │ │ PageHeader: h1 title · description · [actions]             │ │
│ │ 224px         │ │                                                            │ │
│ │ <nav aria-    │ │ SettingsSection  h2 · description                          │ │
│ │  label=       │ │ ┌ panel (one border, rows divided by hairlines) ──────────┐ │ │
│ │  "Settings">  │ │ │ SettingsRow: label + description │ control (end)        │ │ │
│ │ links         │ │ │ SettingsRow (stacked): label + description, control below│ │ │
│ │               │ │ └─────────────────────────────────────────────────────────┘ │ │
│ │               │ │ SettingsSection (destructive tone) …                       │ │
│ └───────────────┘ │ SaveRegion (sticky bottom, only while a form is dirty)      │ │
│                   └────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────┘
```

**Scroll ownership: final shell**, after PR 2 merges, in "Settings shell adoption":

- The **document** is the only vertical scroll container.
- The project layout's header stays sticky (48 px, `--app-header-h`).
- The settings nav is `position: sticky; top: var(--app-header-h)` with
  `max-height: calc(100dvh - var(--app-header-h))`. Its own `overflow-y: auto` is the one allowed exception, used only
  when the nav is taller than the viewport.
- No `h-[calc(100vh-…)] overflow-hidden` shells.
- No ancestor of the nav or the SaveRegion may set `overflow` other than `visible`, otherwise sticky breaks. A test
  asserts this on the rendered shell.
- Focusable elements get `scroll-margin-top: calc(var(--app-header-h) + 16px)` and
  `scroll-margin-bottom: var(--save-region-h)`, so focus and anchor jumps are never hidden under the header or the
  SaveRegion.

**Scroll ownership: interim**, before PR 2 merges. The frozen route keeps its two overflow regions. Section bodies
adopt `PageHeader`, `SettingsSection`, `SettingsRow` and the 760 px column inside the existing content scroller, so the
SaveRegion is sticky to that scroller. Nothing in the interim depends on document scroll, and section PRs make no
claims about the shell.

**Widths** are a primitive prop, never a per-section class:

- `width="default"`: 760 px (47.5 rem), for forms;
- `width="wide"`: 1040 px, only for list-heavy screens (Usage breakdown, Exports runs, Integrations catalog);
- `width="full"`: analytics, the overview grid and the AI page.

The column is start-aligned (`me-auto`), never centred.

**Gutters**, one token for every dashboard page (`PageContainer`): `px-4 sm:px-6 lg:px-8`, `pt-6 lg:pt-8`. Bottom
padding is `pb-8`, plus `var(--save-region-h)` while a SaveRegion shows.

**Vertical rhythm:** 32 px from the header to the first section (`gap-8`), and 40 px between sections (`gap-10`). Inside
a panel, rows are `px-4 py-4 sm:px-5` with a hairline divider (`divide-y divide-border`).

**Type scale** (the sizes allowed in feature code):

- page title: `text-xl font-semibold tracking-tight` (h1);
- section title: `text-base font-semibold` (h2);
- row label: `text-sm font-medium`;
- description and help: `text-sm text-muted-foreground`;
- meta and captions: `text-xs text-muted-foreground`.

Mobile inputs keep the 16 px text the current `Input` already sets, so iOS doesn't zoom. `text-[Npx]` is banned in
`features/**` and the migrated sections. A check script counts it per folder, and the count only goes down.

**Heading levels and cards are scoped to where the section is embedded.** On the settings page, `PageHeader` is the h1
and sections are h2. In the editor's Configuration tab (where the Appearance sections also render), the host passes
`headingLevel`, and the panel chrome follows the host: no panel border inside an already-bordered editor panel. In any
one context there is a single bordered surface level. Nested groups use a divider and a sub-label (`h3`/the next level,
`text-sm font-medium`), never another border. The exceptions are `DataList` rows, which use the panel's dividers, and
`Callout`.

### 5.2 The settings row

- **Layout follows the row's own container width, not the viewport** (container queries `@container`), because the
  same rows render in the 760 px settings column and in narrower editor panels.
- **`inline`** (toggles, selects, short inputs): at container ≥ 560 px, two columns:
  `grid-cols-[minmax(0,1fr)_auto]`, label and description start-aligned with `min-w-0` and wrapping. The control
  column uses an explicit size per control kind:
  - `control="switch"`: intrinsic width;
  - `control="compact"`: `w-48`, for selects and short inputs;
  - `control="field"`: `w-72`, for URLs and emails;
  - `control="auto"`: content width, capped at 50% of the row.
  
  Below 560 px the row stacks. Switches stay at their intrinsic size, end-aligned on the label line. Other controls go
  full width under the description.
- **`stacked`** (textareas, lists, multi-field groups): the label and description on top, the control at full column
  width below.
- **Long content** (domains, emails, Arabic descriptions) wraps (`break-words`). Never truncate a label. Identifiers in
  a control may truncate, and then the full value is in the control's accessible name.
- **ID ownership:**
  - `SettingsRow` owns the label id and the description id. It renders `<label htmlFor>` for a single control, or
    `fieldset` + `legend` for a group (`asFieldset`).
  - `FormField` owns the error id and the `aria-invalid` state.
  - The control's `aria-describedby` is the ordered merge of description, disabled reason and error, composed by one
    helper (`describedBy(...ids)`).
  - Nothing clones children by type to inject ids.

### 5.3 Saving

Every section is one of two kinds, never both:

- **Instant:** a single control whose write is safe to apply on change (§8.2 says which). It shows:
  - a `role="status"` "Saved" hint next to the control, with no toast;
  - on failure, the control's value is restored (rollback or refetch) and a plain-language toast appears.
  
  There is no SaveRegion.
- **Explicit:** text-heavy or multi-field forms. They use TanStack Form and the form lifecycle in §8.3.

**Submit policy (explicit forms).** One rule covers the Save button, Enter in a single-line input, and Cmd/Ctrl+S:

1. Submitting always runs validation and increments `submissionAttempts`. If the form is invalid, nothing is sent. All
   errors become visible (§6.4), focus moves to the first invalid field (scrolling it into view within the scroll
   margins), and a polite live region says "Fix 2 fields".
2. Save is **never** disabled for invalidity. It is disabled only while a submission is in flight (`loading`), so a
   second press or a second Cmd+S is ignored.
3. While the form is **pristine**, the SaveRegion is hidden, so there is nothing to submit and Cmd+S does nothing.
   A pristine-but-invalid form (bad server data) shows its errors on load, and the SaveRegion appears as soon as one
   field changes.

**SaveRegion** (one per page, not one per form):

- Every explicit form on the page registers with it (`useSaveRegion(formId, { isDirty, isSubmitting, submit, discard
  })`). It shows while any registered form is dirty: "Unsaved changes", then Discard, then Save.
- With one dirty form, Save and Discard act on it. With several (rare: General with translations), Save submits every
  dirty form in order and stops at the first invalid one. The region names how many have changes.
- It is `position: sticky; bottom: 0` within the content column, so its containing block spans the forms it serves. It
  sets `--save-region-h` for the column's end padding and the scroll margins, and pads for
  `env(safe-area-inset-bottom)`. It must not cover a focused input: on mobile, when the on-screen keyboard is open
  (`visualViewport` height shrinks), it docks inline at the end of the form instead of floating.
- **Discard** is disabled while a submission is pending. It resets each form to its baseline (§8.3), with no confirm.
- When the region hides after a successful save, focus moves to the page `h1` only if focus was inside the region.
  Otherwise focus stays where it is. The "Saved" status is announced politely.
- **Navigating away** while any form is dirty goes through the route's unsaved-changes guard. The guard reads the same
  registry, with one dirty source per form.

### 5.4 Other dashboard pages

- Overview, Analytics and AI use `PageContainer width="full"` and `PageHeader`. Cards come from `Card` or `StatTile`
  only, laid out on a 12-column grid (`grid-cols-1 md:grid-cols-6 xl:grid-cols-12`).
- **Editor chrome** (B7): toolbars, side panels, page tree, dialogs and the save status use the same primitives
  (`IconButton` with a required label, `StatusBadge`, `ConfirmDialog`, `EmptyState`). Detailed spec after the production
  audit lands.
- **Reader theme** (B8): never imports dashboard primitives. It has its own light components under `components/site/*`
  and stays inside `BUNDLE_BUDGET.md`. It shares only tokens (radius, spacing, type scale) through CSS variables.
  Detailed spec after the production audit lands.

### 5.5 Landmarks and keyboard

- `<main id="main-content" tabIndex={-1}>` wraps the content column, and the skip link targets it. A `main` with
  `tabIndex=-1` is a landmark; the bug today is a focusable generic `div` (fixed by the Organizations thread in PR 2).
- The settings nav is `<nav aria-label="Settings">`, with `aria-current="page"` on the active item. Items are router
  links (`<Link search={{ section }} replace>`), so middle-click and copy-link work.
- One h1 per page (`PageHeader`). Previews (theme, typography) render inert presentational elements, never headings.
- Focus moves to the h1 on section change. Dialogs restore focus to their trigger, or to a fallback when the trigger is
  gone (§6.3).
- **Icon-only buttons** must have a label. The `IconButton` type requires `label`, and a test fails on `size="icon*"`
  buttons without `aria-label`.

### 5.6 RTL and mobile

- Logical properties only (`ms/me/ps/pe/start/end`). Directional icons flip with `rtl:-scale-x-100`.
- **Mixed-direction text:**
  - Text that ends up in a string (toasts, `aria-label`s, interpolated copy) goes through the existing `isolate()`,
    which wraps it in the Unicode isolates FSI…PDI.
  - Names, domains and emails rendered as elements use `<bdi>` or `dir="auto"`.
- **Touch:** targets are 44 px (the existing `--control-size-*` under `pointer: coarse`).
- **Narrow screens:** rows stack by container width (§5.2), tables become `DataList` cards, and the SaveRegion spans the
  column.
- **Test widths:** 320, 390, 768 and 1440 px, plus 200% zoom.

## 6. Primitives

**Where they live.**

- `packages/design-system/src/components/ui/*`: app-agnostic primitives, with no i18n, router, Query or TanStack Form.
  Every label is a prop. The design system has only a `typecheck` script. Its components are tested in `apps/app`'s
  Vitest suite (as `button-loading.test.tsx` already does), and a `test` script is added only if that stops working.
- `apps/app/src/components/ui/*`: app adapters that need i18n, the router or TanStack Form (`FormField`, `SaveRegion`
  registration, `SettingsNavLink`).
- `apps/app/src/lib/forms/*`: form lifecycle hooks (`useServerDraft`, `useSaveRegion`, `fieldErrorsVisible`). These
  are not components and do not live in `components/layout`.

| Primitive | Package | Replaces | Notes |
|---|---|---|---|
| `PageContainer` | DS | 3 gutter variants | `width: 'default' \| 'wide' \| 'full'` |
| `PageHeader` | DS | `SectionHeader`, the 4 header styles | `title` (h1), `description`, `actions`, `back`, `badge` |
| `SettingsSection` | DS | `settings/section.tsx` `SettingsSection`, ad-hoc cards | `title`, `headingLevel`, `description`, `actions`, `tone: 'default' \| 'destructive'`, `chrome: 'panel' \| 'plain'`, `footer` |
| `SettingsRow` | DS | `Field`, `ToggleRow`, `GroupLabel` | §5.2: `layout`, `control`, `asFieldset`, ids exposed through render props |
| `FieldError` | DS (exists) | | presentational only: renders messages under an id it is given |
| `FormField` | app | | TanStack adapter: visibility per §6.4, owns the error id and `aria-invalid` |
| `SaveRegion` | DS view + app registry | `shared.tsx` `SaveBar` | §5.3 |
| `EmptyState` | DS | ad-hoc dashed boxes, "no X" paragraphs | `icon`, `title`, `description`, `action`; `size: 'section' \| 'page'` |
| `DataList` + `RowActions` | DS | hand-built member, domain, key and link rows | rows have `leading`, `title`, `meta`, `badges`, `trailing`. The `RowActions` trigger label must name the row ("Actions for docs.acme.com"). Skeleton and empty slots built in |
| `ConfirmDialog` / `useConfirm` | DS (exists) | | asking only, §6.3 |
| `ActionDialog` | DS | the confirm-then-mutate state machines (members, danger, domain) | executing, §6.3 |
| Disabled adapters | DS + app | `title=` attributes, silent `disabled` | §6.5 |
| `StatusBadge` | DS | 8 local clones (Chip, tones tables, emerald/amber literals) | `tone: neutral \| info \| success \| warning \| danger \| pending`, dot + label; `pending` animates and respects reduced motion. Uses the existing `--success`/`--warning`/`--info` tokens |
| `Callout` | DS | amber `div`s, ad-hoc notes | built on `alert.tsx`, but `role="status"` (or none) by default. `role="alert"` only with `urgent` |
| `CopyButton` | DS | 4 copies of copy + `setTimeout` | announces "Copied" through a polite live region |
| `OptionCards` | DS | `aria-pressed` button groups acting as radios | a real radio group (base-ui RadioGroup), cards with title, description and icon |
| `StatTile` | DS | 4 stat-tile variants | |
| `Meter` | DS | hand-rolled quota bars | `role="meter"` with `aria-valuetext`, for quotas and usage. `Progress` stays for task progress |
| `IconButton` | DS | `Button size="icon"` with an optional label | `label` is required; the tooltip shows the same label |

### 6.1 Composition, not cloning

Primitives expose ids through render props or explicit props (`descriptionId`, `errorId`). `SettingsRow` never inspects
`children.type`. That pattern in today's `Field` (`shared.tsx:144`) is why labels are orphaned on Segmented, Select
and grid controls.

### 6.2 Migration rule for old helpers

`project-settings/shared.tsx` keeps its exports as thin wrappers over the new primitives while sections migrate. When
the last caller moves, the wrapper is deleted in the same PR. The `SaveBar` and `saveConfigSection` bugs (§4.1) are fixed
in the wrappers in B1b, so sections that haven't migrated yet benefit at once.

### 6.3 Dialogs: asking vs executing

- **`useConfirm()` / `ConfirmDialog`**, asking only. This is today's contract (`confirm.tsx`; e.g.
  `domain-section.tsx:104`): it resolves `true` or `false`, and the caller then mutates. It stays, with fixes:
  - a pending promise is settled `false` when the dialog is replaced or the provider unmounts;
  - focus falls back to the page `h1` when the trigger no longer exists.
- **`ActionDialog`**, executing: `onConfirm: () => Promise<void>`.
  - While pending, the confirm button shows `loading`, a second confirm is ignored, and Escape, outside-click and
    Cancel are blocked. The dialog says it is working; it does not silently stay open.
  - On success it closes and resolves.
  - On rejection it stays open and shows the friendly error inside the dialog. The mutation sets
    `meta: { suppressGlobalError: true }`, so the global cache doesn't toast as well, and the person can retry or
    cancel.
  - **Typed confirmation** (`confirmText="docs"`): compares after `trim()` and NFC normalization, case-sensitive,
    with no paste blocking. The confirm button stays enabled, and pressing it with a mismatch shows the field error,
    following the submit policy in §5.3.
  - **Focus:** opens on Cancel for destructive actions. On close it returns to the trigger, or to the h1 or the list's
    heading when the trigger was the deleted row.

### 6.4 Form fields: validation timing (TanStack Form 1.33.5)

- **Validators:** `onBlur` for the first check, `onChange` once the field has been blurred or the form submitted
  (`onChangeAsyncDebounceMs` for async), and `onSubmit` for cross-field rules. A field input must call
  `field.handleBlur`. `FormField` wires `onBlur`, so sections can't forget it.
- **Visibility:** `fieldErrorsVisible(meta, submissionAttempts) = errors.length > 0 && (submissionAttempts > 0 ||
  meta.isBlurred)`. This is a pure function with unit tests over the `isTouched`, `isBlurred` and `submissionAttempts`
  combinations.
- **Server errors** (409 slug taken…) are set with `form.setFieldMeta(name, m => ({ ...m, errorMap: { ...m.errorMap,
  onServer: message } }))`. They clear on the next change of that field: `FormField`'s `onChange` removes `onServer`.
  They are never only a toast.
- **Reset:** `form.reset(baseline)` clears every error map and attempt count. Discard and scope switches use it.

### 6.5 Disabled controls with a reason

There is no universal `aria-disabled` wrapper. Each control kind has an adapter that uses the primitive's own disabled
semantics:

- **Button:** `<Button disabled focusableWhenDisabled disabledReason={…}>`. base-ui's `focusableWhenDisabled` keeps it
  in the tab order while blocking activation, form submission and styling it disabled. The reason is linked through
  `aria-describedby`. On hover and focus a tooltip shows it. The tooltip is anchored on the button itself, never on a
  wrapper button, so no interactive element is nested in another.
- **Menu items** (`RowActions.Item disabledReason`): the item is disabled and the reason renders as a second line of
  the item's text, visible on touch too.
- **Switches and inputs** inside a `SettingsRow`: the row's `disabledReason` renders as visible muted text under the
  description and joins `aria-describedby`.
- **Links:** a disabled link becomes a `span` with the reason as visible text.
- **Touch:** wherever a tooltip would be the only carrier, the reason is also visible text, so touch users see it
  without hover.
- **Busy** controls use `loading`, not a reason.
- **Never usable** controls (a viewer looking at admin-only actions) are hidden, and the section says once, at the top,
  why it is read-only ("You're a Viewer on this site. Ask an Admin to change these settings.").
- **Unknown access** (§7.2) locks controls with no reason text. This is the adapter's `locked` state, distinct from
  "enabled", so a null reason never means "enabled".

## 7. Module structure

### 7.1 Layout

```
apps/app/src/features/<feature>/
  api/
    keys.ts            this feature's query-key factories (canonical; §8.1)
    query-options.ts   queryOptions() factories
    mutations.ts       mutations: an explicit optimism class per mutation (§8.2), meta.errorMessage
    prefetch.ts        prefetchXxx(queryClient, ids) for route loaders
  model/
    *.ts               pure functions: access decisions, reasons, validation, derived view models
    *.test.ts          unit tests (vitest, no DOM)
  components/
    *.tsx              render: read api hooks, call model, compose primitives
    *.test.tsx         behaviour tests (a11y names, error timing, flows)
```

- **No barrel `index.ts`.** Each feature exposes explicit entrypoints: `api/keys.ts`, `api/query-options.ts`,
  `api/hooks.ts` (or `mutations.ts`), `model/*.ts` and `components/<Public>.tsx`. Another feature may import only
  those, never `components/internal/*`.
- **Route files export only `Route`.** Section ids used by `validateSearch` and `beforeLoad` are plain string arrays in
  `features/<f>/model/ids.ts`, with no icons, access policy or prefetch registry. Those non-split route options stay in
  the router's eager chunk, which published pages load (`vite.config.ts` splits loaders and components for every
  non-reader route, but not these).
- **Boundaries**, enforced by `features-boundaries.test.ts`. It parses imports and resolves the `@/` alias and
  re-exports:
  - `model/**` imports nothing from React, `api/**`, `components/**`, `@/services/*` or the design system;
  - `api/**` imports no components;
  - cross-feature imports go only to the public entrypoints listed above;
  - `features/**` never imports `routes/**`.

### 7.2 Bundle protection comes before any move

`scripts/bundle-boundaries.mjs` classifies dashboard code by today's paths
(`components/(app|project|project-settings|settings|analytics|ai-conversations)/`, `hooks/api/`). Code moved into
`features/**` would silently escape both the forbidden-public-module list and the dashboard-chunk classification.
So, in B1b, before the first code moves into `features/**`:

- `features/**` is added to the forbidden-public-modules list, with explicit allow-listed exceptions for `model/ids.ts`
  and any `validateSearch` parsers (today's analytics/AI search validators are already exceptions).
- `features/**` is added to `DASHBOARD_ONLY_MODULE`.
- Their tests in `bundle-boundaries.test.mjs` are updated.
- Every migration PR runs the analyzed check (`BUNDLE_ANALYZE=true` build, then `pnpm -F @nibleaf/app bundle:check`)
  and reports the numbers in the PR body.

`check-bundle-budget.mjs` is a PR 2 file, so any change to it waits. `bundle-boundaries.mjs` is not.

### 7.3 Site access (`features/site-access/`)

- **The input is authoritative server data.** The project members endpoint returns, for each member, the **effective**
  site role, computed by the server with `effectiveSiteRole(orgRole, grant)` in `apps/server/src/actions/members.ts`,
  plus `orgRole` and `viaOrganization`. The client never recomputes an effective role from raw grants. The server
  stays the authority: a client decision only hides or explains controls, and every write is still checked server-side.
  A 403 is mapped to the same reason copy.
- **Explicit states:**

  ```ts
  type SiteAccess =
    | { status: 'loading' }                                  // nothing cached yet
    | { status: 'unavailable'; retry: () => void }           // failed, nothing cached
    | { status: 'ready'; role: SiteRole; orgRole: OrgRole | null; stale: boolean; retry: () => void }  // stale: cached data, refetch failed
    | { status: 'notMember' };                               // signed in, not on this site's team
  type Decision = { kind: 'allowed' } | { kind: 'locked' } | { kind: 'denied'; reason: MessageKey };
  decide(access, action, resource?): Decision
  ```

  - `loading` and `unavailable` → `locked`. Controls are disabled with no reason text; `unavailable` shows a retry
    once, at the section top. This matches `lib/project-settings-access.ts` and `useProjectAdminStatus` today.
  - `ready` → `allowed` or `denied` with a reason. `stale` still decides from cached data, as today.
- **Actions** are a closed union, each with its own policy:
  - `site.settings.manage`, `site.content.edit`;
  - `site.members.manage`, `site.member.remove(member)`;
  - `site.domain.manage`;
  - `site.delete` (org Owner or Admin only, §4.2 of the organizations design);
  - `site.ownership.transfer` (owner only, with a target required);
  - `site.apiKeys.create(scope)`, `site.apiKeys.revoke(key)` (admin, or the creator);
  - `site.exports.create`, `site.exports.schedule`.
  
  Resource-dependent policies take the resource. Rank checks reuse `@nibleaf/shared/rbac` (`canAdminister`, `canEdit`,
  `roleAtLeast`, `canManageMember`) and never compare strings themselves.
- **Hook:** `useSiteAccess(projectId)` shares the members query, as `useProjectAdminStatus` does.
  `useProjectAdminStatus` and `lib/project-settings-access.ts` become thin wrappers over it, and are removed when their
  last callers migrate.
- **Feature models layer state-based reasons on top**, e.g. `domainActions(domain, access)` →
  `{ setPrimary: denied('domain.reason.verifyFirst') }`.
- **Tests:** a table over every role × action × resource case, plus the loading, unavailable and stale states.

### 7.4 Feature map (first pass)

| Feature module | Today | Track |
|---|---|---|
| `site-access` | `lib/project-settings-access.ts`, `hooks/use-project-admin-status.ts`, inline `canAdminister` | B1c |
| `site-settings` (section ids, registry, shell) | `routes/…/settings.tsx` (PR 2 file) | shell adoption |
| `site-general` | `general-section.tsx` | B1b (reference) |
| `site-languages` | `languages-section.tsx`, editor language dialogs | B2 |
| `site-domains` | `domain-section.tsx`, `hooks/api/domains.ts`, `domain-state.ts` | B2 |
| `reader-access` (visibility and access) | `authentication-section.tsx`, `visibility/*`, `hooks/api/reader-access.ts` | B2 |
| `site-search` | `search-section.tsx`, `search-index-diagnostics.tsx`, `hooks/api/project-search.ts` | B2 |
| `addons` | `addons-section.tsx` | B2 |
| `git-sync` | `settings/git-tab.tsx`, `git-workflow.tsx`, `hooks/api/git-workflow.ts` | B3 |
| `openapi` | `openapi-section.tsx` | B3 |
| `content-import` | `settings/import-tab.tsx`, `import-errors.ts` | B3 |
| `api-keys` (AI assistants / MCP) | `settings/api-keys-tab.tsx`, `connected-apps.tsx`, `hooks/api/mcp-oauth.ts` | B4 |
| `integrations` | `settings/integrations-tab.tsx`, `hooks/api/integrations.ts` | B4 |
| `smart-ai` | `smart-ai-section.tsx`, `hooks/api/workspace-ai.ts` | B4 |
| `exports` | `exports-section.tsx`, `hooks/api/exports.ts` | B4 |
| `site-danger`, `usage` | `danger-section.tsx`, `settings/usage-tab.tsx` (PR 2 files) | shell adoption |
| `site-appearance` (branding, theme, styling, typography, navbar, footer, banner, SEO, variables, redirects) | `project-settings/*-section.tsx`, `editor/site-config-panel.tsx` | B5 |
| `site-overview` | `routes/…/index.tsx` | B6 |
| `site-analytics` | `components/analytics/*`, `hooks/api/analytics/*`, 6 child routes | B6 |
| `ai-conversations` | `components/ai-conversations/*`, `hooks/api/ai-conversations.ts` | B6 |
| `editor-chrome` | `components/editor/*` (not the tiptap core) | B7 |
| `members`, `join-links`, `org-*` | | Organizations thread |

`hooks/api/*` modules are moved only when their feature migrates. Until then they are imported as they are.

## 8. Data-flow rules

These extend `apps/app/DATA_LOADING.md` and do not replace it. Its rules (query factories, loader prefetch, skeletons,
`loading` buttons, mutation recipes, overlapping writes) all still hold.

### 8.1 Keys and factories

- **One key tree, with exact tuples preserved.** Moving a key into a feature's `api/keys.ts` keeps the exact tuple it
  has today. Nested prefixes are intentional (project detail, project search and exports all sit under
  `['projects', id, …]`, so invalidating a project reaches them). Roots are not required to be unique.
- **One canonical factory per key.** When a feature takes ownership, `hooks/api/query-keys.ts` delegates to it
  (`domains: domainKeys`) instead of keeping a copy. Before PR 2 merges, that file is frozen, so features that need
  existing keys import them from `queryKeys`, and new keys live only in the feature. A compatibility test asserts that
  the moved factories produce the same tuples as before, and that the documented invalidation prefixes still match.
- **`query-options.ts` and `keys.ts` import no hooks, components, i18n or validators runtime.** Dashboard loaders are
  split out of the eager chunk, but these modules are imported by loaders, hooks and sometimes `beforeLoad`. They stay
  light by rule, and `bundle-boundaries` checks it (§7.2).

### 8.2 Mutations

**Every mutation declares its class in a comment and in its test.**

| Class | When | Behaviour |
|---|---|---|
| **optimistic** | the server outcome is predictable from the input, and the write touches only the item it names | `onMutate` update; per-item rollback by intent where clicks can overlap (shared `scope`, `isMutating` guard before the final invalidation; DATA_LOADING "overlapping writes"); invalidate on settle |
| **server-confirmed** | the server validates externally (domain verify), changes other rows (set primary domain, default language), creates ids, or can refuse for reasons the client can't see | pending state on the control; cache written from the response, then the affected keys invalidated |
| **form save** | explicit forms | `mutateAsync` from `onSubmit`; the SaveRegion shows `loading`; on success, reconciliation as below |

- **Sibling controls stay enabled** during an optimistic write. Controls that share an invariant with a pending
  server-confirmed write ("exactly one primary domain", "one default language") are locked with a "Saving…" reason
  until it settles. That is correct, and it isn't a defect.
- **Reconciliation after a form save.** Each mutation lists the keys it affects. For example, `useUpdateProjectConfig`
  affects the project detail and the projects list today.
  - When the response is the full entity, it is written to the detail key, but only if no newer write to that key is in
    flight (`isMutating` on the same `scope`). Then every affected key is invalidated.
  - Otherwise, the affected keys are only invalidated.
  - A slower, older response never overwrites a newer one: writes to one entity share a `scope`, so they run in click
    order.
- **One owner per error.** A mutation either reports through the global cache (`meta.errorMessage`) or handles its
  error locally (field errors, `ActionDialog`) with `meta.suppressGlobalError`, never both. Copy comes from
  `friendlyErrorMessage`. There are no generic "Couldn't save" messages when the cause is known (permission, conflict,
  signed out).
- **`saveConfigSection` becomes `useSaveConfigSection()`.** It returns a promise that rejects on failure, so `onSubmit`
  keeps the form dirty and maps field errors. The old helper is fixed in place first (§6.2).

### 8.3 The form lifecycle (`useServerDraft`)

**Identity.** `useServerDraft({ identity, source, toValues, form })`. `identity` is the tuple the form edits, e.g.
`[projectId, 'general']` or `[projectId, 'navbar', languageId]`.

- When the identity changes, the form resets to the new source's values and pending state is dropped. If the form was
  dirty, the switch must already have been confirmed by the caller's guard (scope picker, route blocker).

**Three values per form:**

- `baseline`: the editable values last confirmed by the server for this identity;
- `submitted`: the values sent by the in-flight save, if any;
- `current`: the form state.

Comparisons always use the **normalized editable values** `toValues(source)`, never the raw query object, so a refetch
that changes only unrelated fields (`updatedAt`, counters) is not a change.

**Rules:**

1. **Dirty** is `!deepEqual(current, baseline)`. That is the only definition: no `isDirty` mixing, no `extraDirty`,
   no `JSON.stringify`.
2. **When the server value changes:**
   - if the form is clean, the baseline moves and the form resets to it, silently;
   - if the form is dirty and the server change touches fields the person has not edited, those fields update in
     `current` and the baseline moves;
   - if it touches a field the person has edited, the edit is kept and a `Callout` offers "This was changed elsewhere.
     Use theirs / Keep mine". There is no silent overwrite either way.
3. **When a save succeeds**, the baseline becomes `submitted`, reconciled with the response's values when they differ
   (server normalization). Fields the person edited **during** the request (`current ≠ submitted` for that field) keep
   their newer values and stay dirty. Today `general-section.tsx:130` does this by hand; the hook makes it the default.
4. **When a save fails**, the baseline is unchanged, the form stays dirty, field errors are mapped (§6.4), and
   `submitted` is cleared.
5. **Discard** resets `current` to `baseline`. It is disabled while a save is pending.

`useServerDraft` is a small state machine in `lib/forms/server-draft.ts`, with unit tests for every rule above.

### 8.4 URL state

UI state that should survive Back or a reload goes in the URL through `validateSearch`: the selected integration, the
export sub-tab, AI conversation filters, and the Appearance subsection.

- Switching sections, tabs or subsections uses `replace` (Back leaves settings). Opening a detail (an integration, a
  conversation) uses `push` (Back closes it).
- Updates merge into the current search params (`search: prev => ({ ...prev, x })`), so unrelated params are kept.
- Never in the URL: secrets and tokens (Git tokens, API key plaintext, JWT secrets), email addresses being typed, or
  draft text. Those stay in transient component or form state.

### 8.5 Permissions and reasons in components

```tsx
const access = useSiteAccess(projectId);
const domain = domainViewModel(data, access);     // model: flags, labels, decisions
<RowActions label={t('domain.actionsFor', { host: isolate(domain.host) })}>
  <RowActions.Item decision={domain.actions.setPrimary} onSelect={…}>{t('domain.makePrimary')}</RowActions.Item>
</RowActions>
```

The component never calls `canAdminister`, compares `role === 'owner'`, or chains `ready && !indexing && …`. The adapter
turns a `Decision` into enabled, locked, or disabled-with-reason.

## 9. Phase B PR plan

| PR | Content | Files (est.) |
|---|---|---|
| **B1a** `feat(design-system): settings layout primitives` | this doc; PageContainer, PageHeader, SettingsSection, SettingsRow, SaveRegion view, EmptyState, DataList/RowActions, ActionDialog + confirm fixes, Button `disabledReason`, IconButton, StatusBadge, Callout, CopyButton; their tests in `apps/app`. Kept small so the Organizations thread's PR 3 can adopt it at once. OptionCards, StatTile and Meter land with their first user (B2/B4/B6) | ~25 |
| **B1b** `feat(settings): form lifecycle and the General reference section` | `bundle-boundaries` updated for `features/**` (§7.2); `features-boundaries.test.ts`; the `text-[Npx]` counter; `lib/forms/{server-draft,save-region,field-errors}` + tests; `FormField` adapter; `SaveBar`/`saveConfigSection` fixes in `shared.tsx`; `features/site-general` migrated end to end as the worked example; `apps/app/UI_GUIDE.md` (how to build a settings section) | ~20 |
| **B1c** `feat(access): site access model` | `features/site-access` (`decide`, actions, `useSiteAccess`) + table tests; `useProjectAdminStatus` and `project-settings-access` as wrappers; no UI changes | ~10 |
| **Shell adoption**, right after PR 2 merges | settings route on `SettingsPage`: document scroll, sticky nav of links, `<main>`, section registry in `features/site-settings`; Danger zone and Usage migrated | ~20 |
| **B2** `refactor(settings): site group` | Languages, Custom domain, Visibility & access, Search, Add-ons | ~35 |
| **B3** `refactor(settings): publishing group` | Git (tab + workflow), API reference, Import | ~25 |
| **B4** `refactor(settings): AI assistants, integrations, Smart AI, exports` | | ~30 |
| **B5** `refactor(appearance): site configuration sections` | the 11 Appearance sections, in both hosts (settings and the editor Configuration tab), plus `LanguageScopeSection` | ~35, may split |
| **B6** `refactor(dashboard): overview, analytics, AI assistant` | | ~35, may split |
| **B7** editor chrome | after the production audit | tbd |
| **B8** reader theme | after the production audit, within the bundle budget | tbd |
| **B9** production-audit fixes not covered by B2–B8 | | tbd |

B1a, B1b and B1c can be reviewed in parallel. B1c touches no UI.

## 10. Acceptance criteria for every PR

- **Screens:** before/after screenshots at 1440 and 390 px, light and dark, EN and AR, committed under
  `.github/assets/<branch-slug>/`, plus a short video for flows (save, discard, error, confirm). Also checked, not
  necessarily attached: 320 px, 768 px and 200% zoom.
- **States:** loading (skeleton), empty, error with retry, read-only (Viewer), locked (access unknown) and saving are
  all present for every screen touched.
- **Keyboard:**
  - everything is reachable and operable;
  - focus is visible;
  - Enter and Cmd/Ctrl+S follow §5.3;
  - dialogs trap and restore focus.
- **A11y:** every control has a name, disabled controls have reasons, headings are in order, there are no focusable
  generics, and no `role="alert"` is used for information.
- **Tests:** existing behavioural tests move with their code, and their regression scenarios are kept. A test is
  deleted only when the behaviour it checks no longer exists, and the PR says which. New `model` and `lib/forms` code
  is unit-tested.
- **Checks run before push:**
  - `pnpm -F @nibleaf/app typecheck`, `pnpm -F @nibleaf/design-system typecheck`;
  - `pnpm -F @nibleaf/app test` (filtered to touched folders while iterating, full before push);
  - `pnpm exec biome check <touched paths>`;
  - for migrations, the analyzed `bundle:check` (§7.2).
- **Freeze:** no PR 2 file is touched before the master confirms the merge.

## 11. Risks and open questions

- **PR 2 timing.** The shell, Danger, Usage and Members wait for the merge. B1–B5 touch none of PR 2's files.
- **Appearance sections have two hosts** (settings and the editor Configuration tab). B5 tests both hosts and both
  heading contexts.
- **`useServerDraft` conflict UI** ("Use theirs / Keep mine") is new behaviour. It is rare in practice (two people
  editing one site's settings), but it must never silently drop edits.
- **Production audit scope growth (§3).** New findings are mapped to tracks. Anything that needs a product decision
  goes to the master, not to the owner.

## 12. Review log

**Sol (gpt-6.1-sol, high), 2026-11-10.** Applied:

| # | Point | Change |
|---|---|---|
| 1 | The save rules contradicted each other | one submit policy (§5.3) |
| 2 | `useServerDraft` had no baseline contract | identity plus baseline, submitted and current values (§8.3) |
| 3 | Optimism was mandatory | a class per mutation (§8.2) |
| 4 | The bundle claim was wrong, and `features/**` escaped `bundle-boundaries` | §7.1, §7.2 |
| 5 | Site access had no authoritative input and no explicit states | §7.3 |
| 6 | Disabled controls need per-control adapters | §6.5 |
| 7 | `FormField` validator and error timing were incomplete | §6.4 |
| 8 | The scroll owner and SaveRegion containing block were unspecified | §5.1, §5.3 |
| 9 | Row widths and responsiveness | container queries, control widths (§5.2) |
| 10 | Confirm vs action dialogs | §6.3 |
| 11 | Key-root uniqueness was wrong | exact tuples, one canonical factory (§8.1) |
| 12 | Save reconciliation, error ownership and URL rules | §8.2, §8.4 |
| 13 | The PR plan needed splitting, with acceptance criteria per PR and tests that move with code | §9, §10 |
| 14 | Factual fixes: tones exist, 44 px targets, `isolate()` uses Unicode isolates, `Callout` role, `Meter` vs `Progress`, hooks outside `components/layout`, policy-only models, contextual headings and cards | throughout |
