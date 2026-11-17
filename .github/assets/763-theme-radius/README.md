# Theme radius disclosure (#763)

Local synthetic browser evidence, using the actual Theme form, query/mutation
hooks, design-system controls and reader preview. The fictional API is fulfilled
inside the browser. No customer, provider or backing service is used.

Accepted base: `081299f4d304c42a96a655acb308e4d4dc2f93a4`. Theme, Styling and
resolver source was also checked unchanged on refreshed main
`53b68848c7aa553d9d6d14c1113c34002ebe81f8`.

The fixture starts with Signal and a stored Styling radius of Pill. Signal's own
default is Sharp. Both revisions choose Rounded in Theme, save, and reload.

| Value after save/reload | Before | After |
| --- | --- | --- |
| Stored `theme.layout.radius` | `rounded` | `rounded` |
| Theme radius control | Pill | Rounded |
| Stored `styling.radius` | `pill` | `pill` |
| Actual preview `data-theme-radius` | `pill` | `pill` |
| Override disclosure | Absent | Styling: Pill, followed by the existing override explanation |

Rendering sends no writes. Every save sends exactly
`{"theme":{"version":1,"preset":"signal","layout":{"radius":"rounded"}}}`.
The captured light/dark and Arabic/English settings apply to the preview itself
as well as the surrounding form. All 16 runs have zero page errors, horizontal
overflows, or non-local attempts. [Machine-readable results](results.json).

Before editing the component, the fixed-control assertion was run against the
unchanged base. It exited 1 with `actual: 'Pill', expected: 'Sharp'`. The same
capture script passed both phases after the fix. The earlier setup attempts
exposed a missing local server RPC build and a trigger-arrow text assertion;
the final harness resolves this checkout's RPC source and reads the selected
value element. A low-RAM attempt stopped before taking the lock.

| Locale / width | Before light | Before dark | After light | After dark |
| --- | --- | --- | --- | --- |
| EN / 390 | [PNG](before-en-390-light.png) | [PNG](before-en-390-dark.png) | [PNG](after-en-390-light.png) | [PNG](after-en-390-dark.png) |
| EN / 1440 | [PNG](before-en-1440-light.png) | [PNG](before-en-1440-dark.png) | [PNG](after-en-1440-light.png) | [PNG](after-en-1440-dark.png) |
| AR / 390 | [PNG](before-ar-390-light.png) | [PNG](before-ar-390-dark.png) | [PNG](after-ar-390-light.png) | [PNG](after-ar-390-dark.png) |
| AR / 1440 | [PNG](before-ar-1440-light.png) | [PNG](before-ar-1440-dark.png) | [PNG](after-ar-1440-light.png) | [PNG](after-ar-1440-dark.png) |

[Interaction recording](interaction.webm): choose Rounded while Styling remains
Pill, save, reload, and inspect the persisted Theme choice and disclosure.

Reproduce with `node .github/assets/763-theme-radius/capture.mjs` after setting
`NIBLEAF_DEVSTACK_LOCK` to the owner's canonical directory. The script checks
free RAM and port availability, takes the directory with atomic mkdir and
`owner.txt`, uses only strict port 4310, launches through `withLocalOnlyBrowser`,
then closes its server and releases only its own lock in `finally`. Baseline
source is pinned in the script; `BASELINE` can explicitly select another revision.

This is programmatic interaction in an isolated fixture, not an ordinary account
journey or production acceptance. It does not exercise authentication, a real API,
publication or a deployed reader. The shared reader resolver and actual studio
preview provide the effective-radius readback here; unit/static checks are
reported separately in the PR.
