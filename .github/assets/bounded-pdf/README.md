# Bounded PDF rendering evidence

The PNGs are direct renders of pages 2 and 4 from the real export renderer's
five-page PDF, generated with four fictional English/Arabic articles. They show
language direction, tables, mixed numbers, internal links and continuous footers.
The fixture contains no customer content or authenticated browser state.

The unchanged input to a separate full-size local acceptance run contained 308
published articles and 1,175 referenced assets (69,159,309 bytes). The previous
whole-site HTML renderer crashed Chromium with a container OOM at a 1 GiB limit.
After the asset-resolution fix, the full local run completed in 248.2 seconds
on one CPU, with a 625,647,616-byte cgroup memory peak and zero OOM events.
An earlier cold run after a Docker restart completed at the configured 1 GiB
cap with 538 memory-limit reclaim events and zero OOM/OOM-kill events. The cap
includes filesystem cache; the warmer run is not a universal headroom claim.
The final PDF had 1,097 pages, all footers matched
their global page numbers, and all 189 internal destinations were valid. These
are backend/local receipts, not production or native Chrome download acceptance.

A screen recording would not demonstrate the worker's memory behavior. The
rendered outputs and checks of the actual PDF destinations provide verification
of the preserved artifact interaction; there is no new web UI interaction.
