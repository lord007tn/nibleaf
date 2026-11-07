# Editor: site settings only for members who can change them

Headless Chromium against an isolated local stack with the seeded demo workspace, English and
Arabic, 1440 × 900 and 390 × 844. The demo user is the site's owner. For the "member" captures,
the browser rewrote the member-list response so that same user appears with the `member` role
(a writer). Everything else, including the server's own permission checks, is real.

| File | What it shows |
| --- | --- |
| `before-member-en-desktop-editor.png`, `before-member-ar-mobile-editor.png` | Before: a writer sees the site **Settings** button (the sliders icon next to Preview on a phone). |
| `before-member-en-desktop-settings.png`, `before-member-en-desktop.gif` | Before: opening it shows the full site settings form with **Save changes**, which the server refuses for writers. |
| `after-member-en-desktop-editor.png`, `after-member-ar-mobile-editor.png` | After: writers don't get the button; page settings and everything else are unchanged. |
| `after-admin-en-desktop-settings.png`, `after-admin-en-desktop.gif`, `after-admin-ar-mobile-editor.png` | After: admins and owners still see and use site settings exactly as before. |
