# Search index bootstrap recovery

Captured on 17 October 2026 using the actual diagnostics component and TanStack Query hooks in an isolated browser harness. Only the API data is simulated: the provider starts unavailable, Reindex creates a pending run, and initialization completes after twelve seconds. The three-page, six-chunk corpus is fictional. No customer information, credentials, vectors, or provider calls appear in this evidence.

- [Initial unavailable state](before.png)
- [Pending initialization](pending.png)
- [Ready without reloading](ready.png)
- [Continuous browser screencast](recovery.gif), encoded from timestamped Chrome screencast frames. Static periods retain their captured duration; no page reload occurs after clicking Reindex.

The hook keeps polling while the durable run is PENDING or RUNNING, including when collection bootstrap makes provider health unavailable. It stops when the run reaches READY/FAILED, or when an unavailable provider has no active run. Regression tests failed against the previous hook and pass after the change.

The companion chunking regression retains authored definitions in headings that have no body. This evidence establishes local UI recovery; production activation, live reindex and customer-answer acceptance are separate release steps.
