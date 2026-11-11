# Page history capture

Run only against the disposable `nibleaf-page-history` shared-service namespace,
after migrating it and building the server. No customer rows or browser profile
are used. The script refuses other database names and occupied ports.

```powershell
python C:/Users/raedb/Desktop/Work/product-ops/infrastructure/shared-services/services.py provision --project nibleaf-page-history
node --env-file="$env:LOCALAPPDATA/ProductOps/shared-services/projects/nibleaf-page-history.host.env" --import tsx tests/integration/page-history/capture.mjs
python tests/integration/page-history/gifs.py
```

The capture starts one API/editor stack on 4811/4810, creates fictional records,
and uses headless playwright-core with Chromium 1248. Each EN/AR desktop/mobile
journey opens the overflow menu, selects History, compares a revision and restores
it through the real API. Assertions check the editor content, persisted content,
undo snapshot, direction and document overflow. The `finally` block stops the
exact app PIDs and removes only its fixture rows. No worker is required.

Screenshots and GIFs are committed in `.github/assets/feat-page-history`.
Intermediate frames and logs stay in the system temporary directory.
