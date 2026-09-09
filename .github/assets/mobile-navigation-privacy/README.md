# Mobile navigation and privacy UI verification

Sanitized local renders of the changed production components: English/Arabic marketing at320,390 and1440px, explicit privacy preferences, self-hosting overview, and mobile account/project sidebar navigation. The 20.8-second sidebar video shows selecting Settings and the drawer closing. Account and destination content are synthetic; the harness uses the actual sidebar primitives and click handlers with local route-state stubs. Public metadata is synthetic and no real analytics collection is used. These are component-level checks, not a full backend or deployment claim. Production and authenticated before evidence are retained privately.

The initial analytics choice stays unset and Google code remains unloaded. Preferences open from the footer, Close/Escape restore trigger focus, and acceptance/withdrawal/event behavior is covered by focused tests. Detailed installation documentation remains available through the deployment-guide link.
