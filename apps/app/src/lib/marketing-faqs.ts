/** Marketing FAQ shared by the visible page and matching FAQPage JSON-LD. */
export const marketingFaqs: { q: string; a: string }[] = [
  {
    q: 'Can I use Nibleaf Cloud now?',
    a: 'Yes. Nibleaf Cloud is live and free while in beta — managed docs hosting, sign-in, publishing, search, and custom domains.',
  },
  {
    q: 'Is Nibleaf open source?',
    a: 'The codebase is licensed under AGPL-3.0. Public source and container access are currently unavailable, so anonymous self-hosting is paused.',
  },
  {
    q: 'What happens after the beta?',
    a: 'Paid cloud plans will come later, announced with generous advance notice, and beta workspaces will get preferential treatment. Self-hosting availability is tracked separately.',
  },
  {
    q: 'Are there limits during the beta?',
    a: 'The beta runs on a fair-use basis rather than hard plan limits. If a workspace is unusually heavy on resources, we will reach out before anything changes.',
  },
  {
    q: 'Can I use my own object storage?',
    a: 'Absolutely. Nibleaf speaks the S3 API, so it works with any S3-compatible storage (AWS S3, Cloudflare R2, Backblaze B2, or the bundled storage service).',
  },
  {
    q: 'How does search work?',
    a: 'Every published site is indexed with Orama for full-text and fuzzy search, served directly from your API — no external service.',
  },
];
