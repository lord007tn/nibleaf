# People UI on the design-system Checkbox and RadioGroup — before and after

These were captured from a local dev stack with a fresh sign-up (`*@example.test`) and two added websites ("Help Center" and "دليل المنتج"). The viewport is 1280×900, and each screenshot shows the dialog only. `before-` is main at 9f4e35bd, which uses native inputs; `after-` is this PR.

- `*-en-invite-dialog.png` — the organization Members page → Invite people. The organization role is a radio list, and website access is a checklist with a role per ticked website.
- `*-en-invite-keyboard-focus.png` — the same dialog after Tab into the role group and arrow keys. The focus ring sits on the chosen radio.
- `*-en-add-people-dialog.png` — a website's Team page → Add people: the website role as a radio list.
- `*-ar-invite-dialog.png` — the invite dialog in Arabic (RTL): the controls sit on the start side, and website names keep their own direction.

The "unavailable role, with its reason" state can't be reached with real data: only a website's Admins (and the organization's Owner and Admins) can open these dialogs, and every one of them may give every website role. That state is covered by `role-options.test.tsx`.
