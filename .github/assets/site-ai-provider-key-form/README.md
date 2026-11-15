# Site AI key form: pure model and design-system consent box

Before (`main@da1a096e`) and after (`54edbdad`) captures of the site's own key
form (`ProviderKeyForm`) as it opens inside its source card on **AI answers**,
in English and Arabic at 1440 px and 390 px (light theme).

How they were made: a temporary Vite build of the real component, design
system and EN/AR catalogs in a card-sized frame, opened in headless Chromium
through `tests/integration/lib/capture-env.mjs` (dev-stack lock, local-only
browser). The single `GET …/settings/ai` request was answered by interception
with a fictional connection; the key typed is a made-up string. No server,
database, AI provider or real key was used, and 0 requests left the fixture
origin. "Before" swaps in the baseline `provider-key-form.tsx`; nothing else
differs. The temporary build was deleted after the run.

| Files | What it shows |
| --- | --- |
| `{before,after}-first-setup-{en,ar}-{1440,390}.png` | No key saved yet: four steps to do, Save disabled with "Paste an API key first." Unchanged. |
| `{before,after}-replace-unticked-{en,ar}-{1440,390}.png` | A new key typed over a stored one. Before: a native 13 px checkbox. After: the design-system `CheckboxField` (16 px box, the label as its name, the key hint as its description). Save stays disabled with the same reason. |
| `{before,after}-replace-ticked-{en,ar}-{1440,390}.png` | Consent ticked: Save is enabled and its reason is gone, before and after. In Arabic the box sits on the start (right) side. |

`evidence.json` records, for every capture, the steps' state, whether Save is
disabled and the reason it points to, the consent control's kind, name,
description, checked state and size, the API requests, page errors (none) and
horizontal overflow (none).
