# Organizations people (PR 3) — screenshots and walkthroughs

Captured from a local dev stack with seeded, fictional people (`*@example.test`): one organization
("Acme Docs") with 8 websites and 10 people across every role, a second organization ("Vera Studio"),
pending and expired invitations, and active and disabled join links.
Prefix: `en-`/`ar-` interface language (Arabic is RTL); `desktop` is 1440×900, `phone` is 390×844.
Design reference: `operations/organizations-design.md` §4, §5.1, §5.3, §6.1–§6.9.

## Walkthroughs (WebM)

- `walkthrough-org-members.webm` — Owner: search, disabled reasons in the row menu, add a website in the access sheet and save, invite with an error shown only after submit, invite result, revoke the invitation, then on a website's Team page change a role (optimistic).
- `walkthrough-join-and-accept.webm` — A Member without websites joins through a link and lands on the org; opening the same link again says "You're already a member"; an invalid invitation shows one honest state.

## Organization Members (`/app/o/$slug/members`)

- `en-desktop-org-members.png` — Full page: people table (role, website chips with +N, last active, labelled ⋯), pending invitations and join links with counts.
- `en-desktop-org-members-top.png` — Above the fold.
- `en-desktop-row-menu-self-reasons.png` — The Owner's own row: every unavailable action says why.
- `en-desktop-row-menu-member.png` — A Member's row: Manage access, Transfer ownership ("Make them an Admin first"), Remove.
- `en-desktop-admin-menu-on-owner.png` — An Admin looking at the Owner's row.
- `en-desktop-access-sheet.png` — Side sheet: org role options with descriptions, website checklist with a role per website.
- `en-desktop-access-sheet-demote.png` — Admin → Member: "Which websites can they still open?".
- `en-desktop-invite-untouched.png` — Untouched invite dialog: no red, Send enabled.
- `en-desktop-invite-error-after-submit.png` — The error appears only after Send (or after leaving a typed field).
- `en-desktop-invite-filled.png` — Several addresses, Member, two websites.
- `en-desktop-invite-result.png` — Result step: whether an email went out, Copy link per person.
- `en-desktop-invitation-menu.png` — Invitation row menu: Copy invite link, Resend, Revoke.
- `en-desktop-revoke-dialog.png` — Revoke confirmation (its own dialog; the title never flips while closing).
- `en-desktop-create-link-warning.png` — New join link: Viewer by default; Editor/Admin shows a warning.
- `en-desktop-link-created-once.png` — The link URL, shown once.
- `en-desktop-filter-no-match.png` — No match: an empty state offering "Clear filters".
- `en-desktop-org-members-as-member.png` — A Member opening Members: "Administrator access required".
- `ar-desktop-org-members.png`, `ar-desktop-access-sheet.png`, `ar-desktop-invite-dialog.png` — The same in Arabic (RTL).
- `en-phone-org-members.png`, `en-phone-access-sheet.png`, `ar-phone-org-members.png` — 390 px.

## Website Team (Settings → Team)

- `en-desktop-site-team.png` — Owner: "From the organization" (via organization), "Website access" with role selects, pending invitations (only when there are some), join links, "Manage people in Acme Docs".
- `en-desktop-site-role-options.png` — Role select: each role with a one-line description.
- `en-desktop-site-add-people-suggestions.png` — Add people: suggestions from the org roster, role options.
- `en-desktop-site-team-as-site-admin.png` — A site-only Admin (no org link, roles up to Admin).
- `en-desktop-site-team-as-editor.png` — An Editor: read-only, one line saying why.
- `ar-desktop-site-team.png`, `en-phone-site-team.png` — Arabic and 390 px.

## Accept invitation and join pages

- `en-desktop-accept-signed-out.png` — Org, inviter, what you get, what Nibleaf is; create an account or log in.
- `en-desktop-accept-wrong-account.png` — Signed in as someone else: switch account, no Accept.
- `en-desktop-accept-expired.png` — "This invitation expired. Ask Sara Haddad to send it again."
- `en-desktop-accept-invalid.png` — One honest state with Log in / Create an account (PUBLIC-09).
- `en-desktop-join-signed-out.png` — Join link for a visitor: org, inviter, websites and roles, domain rule.
- `en-desktop-join-ready-member.png` — An org Member without these websites: what joining adds.
- `en-desktop-join-already-member.png` — The Owner opening a link: "You're already a member of Acme Docs" + Open.
- `en-desktop-join-invalid.png` — "This invite link isn't valid".
- `ar-phone-accept-signed-out.png`, `ar-phone-join-invalid.png` — Arabic at 390 px.
