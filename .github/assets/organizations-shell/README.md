# Organizations shell (PR 2) — screenshots and walkthroughs

Captured from a local dev stack (`nibleaf-orgs`) with seeded, fictional people (`*@example.test`).
Prefix: `en-`/`ar-` interface language (Arabic is RTL); `desktop` is 1440×900, `phone` is 390×844.
Design reference: `operations/organizations-design.md` §5.

## Walkthroughs (WebM)

- `walkthrough-create-org-and-website.webm` — Create organization from the switcher footer, then the first website inside it.
- `walkthrough-delete-org-welcome-accept.webm` — Delete the only org → /app/welcome → wordings → accept a pending invitation.
- `walkthrough-desktop-switcher-en.webm` — Desktop EN: Websites → switcher (arrows, pane change, search, G then O) → org pages → website level and [Website ▾] → inbox → palette → Account.
- `walkthrough-phone-switcher-ar.webm` — 390 px AR (RTL): sheet drill-down, open a website, Account.
- `walkthrough-removed-while-viewing.webm` — Removed from an org while viewing it: redirect + toast, inbox hides its items.

## Screenshots

- `ar-desktop-1to1-switcher.png` — 1:1 state: one org per website in the switcher, names as today, sign-up "<First>'s workspace" too.
- `ar-desktop-1to1-websites.png` — 1:1 state (before the merge): org named as the website, one website in it.
- `ar-desktop-account-delete-blocked.png` — Delete account refused while owning organizations: dialog lists them with links.
- `ar-desktop-account-notifications.png` — Personal email notifications (UserPreference).
- `ar-desktop-account.png` — Account settings: plain "Account" header, "Back to <last org>", profile, email, sign-in methods, devices, delete account.
- `ar-desktop-after-transfer-now-admin.png` — After transfer the previous Owner is an Admin (no Danger-zone transfer/delete).
- `ar-desktop-command-palette.png` — Command palette scoped to the current org + Switch organization or website…, Create organization, Account settings, Switch organization… list.
- `ar-desktop-inbox-all.png` — Bell inbox across orgs: each item labelled "Org · Website" with the org avatar; filter set to All.
- `ar-desktop-inbox-this-org.png` — Inbox filtered to "This organization".
- `ar-desktop-member-admin-required.png` — Member opening an Owner/Admin page: "Administrator access required".
- `ar-desktop-member-no-websites.png` — Member without grants: "You don't have access to any websites in <Org> yet. Ask an Admin: <names>."
- `ar-desktop-member-settings-leave-only.png` — Member in org Settings: only "Leave organization".
- `ar-desktop-org-analytics.png` — Org Analytics, limited to this org's websites you can open.
- `ar-desktop-org-billing.png` — Usage & billing (Owner/Admin): plan, org totals, seats, per-website breakdown.
- `ar-desktop-org-members.png` — Org Members, read-only: person, org role, "All websites" / "N websites"; Invite placeholder (PR 3).
- `ar-desktop-org-settings-owner.png` — Org Settings as Owner (full page) in Arabic.
- `ar-desktop-org-settings.png` — Org Settings as Owner: General (name, URL handle + alias note, logo), Invitations, Danger zone.
- `ar-desktop-org-websites.png` — Org Websites page (Owner): cards with status and domain, first-run checklist, New website.
- `ar-desktop-switcher-many-orgs.png` — [Org ▾] two-pane popover: search, Recent (website · org), Organizations with role badges; current org first; websites of the current org on the other pane.
- `ar-desktop-switcher-member-org-focused.png` — Arrow keys move to JOODPMS (Member): the websites pane follows focus, only granted websites, no "New website".
- `ar-desktop-switcher-one-org.png` — One organization: the popover leads with that org's websites; "New organization" still offered.
- `ar-desktop-switcher-search.png` — Typing in a list focuses search: one flat list of orgs and "Website · Org" results.
- `ar-desktop-switcher-websites-pane.png` — Right/Left arrow (mirrored in RTL) moves focus into the websites pane.
- `ar-desktop-transfer-confirm.png` — Transfer ownership to an org Admin, confirmed by typing the org name.
- `ar-desktop-website-danger.png` — Website Danger zone (org Owner/Admin only): delete website, the org and members remain.
- `ar-desktop-website-delete-confirm.png` — Type the website name to delete.
- `ar-desktop-website-deleted-back-to-org.png` — After deleting a website: back on the org's Websites.
- `ar-desktop-website-plan-moved.png` — Old ?section=plan link: one-line pointer to the org's billing above website Usage.
- `ar-desktop-website-settings-groups.png` — Website level: [Org ▾] / [Website ▾] / Settings; groups Website · Publishing · Team & access · Usage · Advanced.
- `ar-desktop-website-switcher.png` — [Website ▾]: compact search + list of this org's websites only.
- `ar-desktop-website-usage-pointer.png` — Website Usage (website DTO) with "Plan and billing are managed by <Org> →".
- `ar-desktop-welcome-create.png` — /app/welcome, create wording.
- `ar-desktop-welcome-invitation.png` — /app/welcome, invalid-invitation wording.
- `ar-desktop-welcome-left.png` — /app/welcome, neutral wording after leaving/removal.
- `ar-phone-account.png` — 390 px Account settings.
- `ar-phone-org-websites.png` — 390 px: org Websites page.
- `ar-phone-switcher-screen1.png` — 390 px full-height sheet, screen 1: search, Recent, Organizations (≥44 px rows).
- `ar-phone-switcher-screen2.png` — 390 px sheet, screen 2: tapped org's websites with back arrow, org header (Websites link, ⚙) and pinned footer.
- `ar-phone-website-breadcrumb.png` — 390 px website page: org as avatar, then [Website ▾].
- `ar-phone-welcome-create.png` — 390 px /app/welcome, create wording.
- `ar-phone-welcome-invitation.png` — 390 px /app/welcome, invalid-invitation wording.
- `ar-phone-welcome-left.png` — 390 px /app/welcome, neutral wording.
- `en-desktop-1to1-switcher.png` — 1:1 state: one org per website in the switcher, names as today, sign-up "<First>'s workspace" too.
- `en-desktop-1to1-websites.png` — 1:1 state (before the merge): org named as the website, one website in it.
- `en-desktop-account-delete-blocked.png` — Delete account refused while owning organizations: dialog lists them with links.
- `en-desktop-account-notifications.png` — Personal email notifications (UserPreference).
- `en-desktop-account.png` — Account settings: plain "Account" header, "Back to <last org>", profile, email, sign-in methods, devices, delete account.
- `en-desktop-after-leave.png` — After leaving: landed on another org.
- `en-desktop-command-palette.png` — Command palette scoped to the current org + Switch organization or website…, Create organization, Account settings, Switch organization… list.
- `en-desktop-create-organization-dialog.png` — Create organization from the switcher footer.
- `en-desktop-create-website-in-org.png` — New website dialog creates the website inside this org (no new org).
- `en-desktop-delete-org-confirm.png` — Delete organization: summary of websites/pages to delete, type the org name.
- `en-desktop-inbox-after-removal.png` — Inbox after removal: JOODPMS items are hidden.
- `en-desktop-inbox-all.png` — Bell inbox across orgs: each item labelled "Org · Website" with the org avatar; filter set to All.
- `en-desktop-inbox-this-org.png` — Inbox filtered to "This organization".
- `en-desktop-leave-confirm.png` — Leave organization confirmation.
- `en-desktop-member-admin-required.png` — Member opening an Owner/Admin page: "Administrator access required".
- `en-desktop-member-no-websites.png` — Member without grants: "You don't have access to any websites in <Org> yet. Ask an Admin: <names>."
- `en-desktop-member-role-badges.png` — Member's Websites page shows their role on each granted website.
- `en-desktop-member-settings-leave-only.png` — Member in org Settings: only "Leave organization".
- `en-desktop-new-org-empty.png` — New organization lands on its Websites empty state ("Create your first website").
- `en-desktop-new-org-with-website.png` — The new org with its first website.
- `en-desktop-org-analytics.png` — Org Analytics, limited to this org's websites you can open.
- `en-desktop-org-billing.png` — Usage & billing (Owner/Admin): plan, org totals, seats, per-website breakdown.
- `en-desktop-org-members.png` — Org Members, read-only: person, org role, "All websites" / "N websites"; Invite placeholder (PR 3).
- `en-desktop-org-settings-admin.png` — Org Settings as Admin (no transfer/delete; Leave available).
- `en-desktop-org-settings.png` — Org Settings as Owner: General (name, URL handle + alias note, logo), Invitations, Danger zone.
- `en-desktop-org-websites.png` — Org Websites page (Owner): cards with status and domain, first-run checklist, New website.
- `en-desktop-removed-while-viewing-toast.png` — Removed from JOODPMS while viewing it: redirected to the landing org with "You no longer have access to JOODPMS".
- `en-desktop-switcher-many-orgs.png` — [Org ▾] two-pane popover: search, Recent (website · org), Organizations with role badges; current org first; websites of the current org on the other pane.
- `en-desktop-switcher-member-org-focused.png` — Arrow keys move to JOODPMS (Member): the websites pane follows focus, only granted websites, no "New website".
- `en-desktop-switcher-one-org.png` — One organization: the popover leads with that org's websites; "New organization" still offered.
- `en-desktop-switcher-search.png` — Typing in a list focuses search: one flat list of orgs and "Website · Org" results.
- `en-desktop-switcher-websites-pane.png` — Right/Left arrow (mirrored in RTL) moves focus into the websites pane.
- `en-desktop-website-plan-moved.png` — Old ?section=plan link: one-line pointer to the org's billing above website Usage.
- `en-desktop-website-settings-groups.png` — Website level: [Org ▾] / [Website ▾] / Settings; groups Website · Publishing · Team & access · Usage · Advanced.
- `en-desktop-website-switcher.png` — [Website ▾]: compact search + list of this org's websites only.
- `en-desktop-website-usage-pointer.png` — Website Usage (website DTO) with "Plan and billing are managed by <Org> →".
- `en-desktop-welcome-accepted.png` — Accepted the invitation from /app/welcome: landed in the org.
- `en-desktop-welcome-after-leaving.png` — Zero orgs after deleting the last one: /app/welcome (neutral wording) with a pending invitation.
- `en-desktop-welcome-invitation-invalid.png` — /app/welcome after an invalid invitation: "You don't have access to an organization yet…".
- `en-desktop-welcome-never-had-one.png` — /app/welcome, "Create your organization" wording (name prefilled "<First name>'s organization").
- `en-phone-1to1-switcher.png` — 390 px, 1:1 state switcher.
- `en-phone-account.png` — 390 px Account settings.
- `en-phone-org-websites.png` — 390 px: org Websites page.
- `en-phone-switcher-one-org.png` — 390 px, one organization: opens straight on its websites.
- `en-phone-switcher-screen1.png` — 390 px full-height sheet, screen 1: search, Recent, Organizations (≥44 px rows).
- `en-phone-switcher-screen2.png` — 390 px sheet, screen 2: tapped org's websites with back arrow, org header (Websites link, ⚙) and pinned footer.
- `en-phone-website-breadcrumb.png` — 390 px website page: org as avatar, then [Website ▾].
- `en-phone-welcome-create.png` — 390 px /app/welcome, create wording.
- `en-phone-welcome-invitation.png` — 390 px /app/welcome, invalid-invitation wording.
- `en-phone-welcome-left.png` — 390 px /app/welcome, neutral wording.
- `en-two-tabs-tab1-acme.png` — Two tabs, tab 1 on Acme Docs (same session).
- `en-two-tabs-tab2-joodpms.png` — Two tabs, tab 2 on JOODPMS as a Member: role badges on granted websites; the URL alone decides the org.
