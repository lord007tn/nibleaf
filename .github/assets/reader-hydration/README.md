# Reader hydration continuity

All documents shown here are fictional QA fixtures. No account state, customer content, provider requests or production mutations were used by the after-check.

The before capture is an independent anonymous public-reader observation on revision `25a4b3e92726c9a5f07c5337c3a15f857f754009`. An actual server-rendered Arabic paragraph was visible at 930.3 ms, removed at 1270.3 ms and restored at 1439.8 ms: **169.5 ms of blank article content after it had appeared**. The original HTTP HTML contained one actual matching article paragraph, separately from two serialized-data matches. There were no page exceptions.

The after captures use a local production app build from `c0f2e43597109a7e70c723224ca0d3fb75b7c4fd` plus the reader metadata-transition fix. Every first-party JavaScript request was delayed by 1200 ms. A MutationObserver and 25 ms sampling watched each fresh English/Arabic mobile/desktop navigation for more than five seconds. All four kept exactly one visible article paragraph after its first appearance, with no hydration-console errors, page exceptions or horizontal overflow. Non-GET requests and external origins were blocked; no auth state was loaded.

- [Before: empty Arabic article](before-ar-desktop.png)
- [After: Arabic desktop](after-ar-desktop.png), [Arabic mobile](after-ar-mobile.png)
- [After: English desktop](after-en-desktop.png), [English mobile](after-en-mobile.png)
- [Short Arabic desktop recording](after-ar-desktop.webm)
- [Privacy-safe timing measurements](timeline.json)

The before and after use different fictional documents and environments. Their absolute load times are not a performance comparison. The after captures demonstrate compiled local behavior; they do not establish deployment of this fix.

The regression test streams the real server renderer, creates a separate cold client module cache, holds the client's Markdown import pending, and lets the real language-alternates effect update its provider. Both languages lose their original paragraph before the fix; both retain the same paragraph node throughout hydration after it. The renderer remains code split and the public JavaScript budget is unchanged.
