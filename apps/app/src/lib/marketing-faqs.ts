/** Marketing FAQ shared by the visible page and matching FAQPage JSON-LD. */
export const marketingFaqs: { q: string; a: string }[] = [
  {
    q: 'Can I use Nibleaf Cloud now?',
    a: 'Yes. Nibleaf Cloud is free during the beta, with no card at sign-up. It provides managed docs hosting, sign-in, publishing, built-in search, and custom domains. No paid cloud plan is offered today.',
  },
  {
    q: 'Is Nibleaf open source?',
    a: 'Yes. The source repository is public under AGPL-3.0, and the self-hosted release has Docker Compose deployment configuration. Check release assets and deployment prerequisites before installing.',
  },
  {
    q: 'What happens after the beta?',
    a: 'No paid cloud plan is currently offered. Future prices, dates, and beta discounts are not specified here. Self-hosting remains available under AGPL-3.0; you cover infrastructure, external services, maintenance, and operator time.',
  },
  {
    q: 'Are there limits during the beta?',
    a: 'No page or seat plan cap is published for the beta. Fair-use safeguards, feature limits, and operator quotas still apply, including AI request/token budgets and import/export limits.',
  },
  {
    q: 'Can I use my own object storage?',
    a: 'When you self-host, the instance operator can configure S3-compatible object storage. This is an instance-level integration; workspace-level bring-your-own storage on Nibleaf Cloud is not promised here.',
  },
  {
    q: 'How does search work?',
    a: 'Built-in Orama full-text and fuzzy search works without an AI key. Section links, recent queries, cross-language results, retry states, optional hybrid retrieval (Qdrant plus an embedding connection), Ask AI reader chat with citations and follow-ups, and workspace OpenAI/OpenRouter keys are available in self-hosted v0.2.1, and on Nibleaf Cloud as it rolls out. Ask AI needs a workspace or instance AI provider key, per-site opt-in, and the Qdrant service when self-hosting. The editor writing assistant uses the instance key.',
  },
];
