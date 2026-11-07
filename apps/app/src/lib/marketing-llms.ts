import { marketingMarkdownSourceUrls } from '@/lib/marketing-sitemap';

/** Public product copy shared by the machine-readable marketing documents. */
const capabilities = `Nibleaf is an AGPL-3.0 documentation platform with a browser editor over Markdown/MDX, versioned publishing, built-in search, Arabic/RTL authoring, and custom domains.

- Authoring: visual and source editing, supported MDX components, review comments on supported block anchors, a guided dashboard home, and a command palette. Exported components and assets need compatible rendering at the destination; arbitrary MDX fidelity is not guaranteed.
- Publishing: preflight and confirmation queue an immutable snapshot deployment with monitored status. The last ready publication stays live during a new deployment. Rollback creates a new ready deployment from an earlier published snapshot.
- Search: built-in Orama full-text/fuzzy search that needs no AI key or Qdrant. Section links, recent queries, cross-language results, keyboard/mobile controls, retry states, and optional hybrid retrieval (Qdrant, an embedding connection, an index, and an evaluated cutover from the default shadow mode) are in the open-source code now, arriving in the next self-hosted release and on Nibleaf Cloud as it rolls out.
- Ask AI reader chat with section citations, follow-ups, refusal and optional support links, workspace OpenAI/OpenRouter keys, the support MCP, and docs-owner insights are in the open-source code now, arriving in the next self-hosted release and on Nibleaf Cloud as it rolls out.
- Ask AI prerequisites: an AI provider key from the workspace or instance, per-site opt-in, and a ready published index; self-hosters also need the optional Qdrant service, and answers from the instance key need SEARCH_ANSWER_ENABLED=true. Request and token budgets apply. Workspace keys can fund embeddings and answers. The editor writing assistant separately uses the instance key.
- Support MCP: project-bound tools can draft, edit, move, translate, set visibility, and publish only after a confirmed preview. Presets are Read only / Support writer / Full admin, with OAuth sign-in or expiring personal keys. MCP is off by default for self-hosters. Writes affect the working copy; publishing includes the project's pending changes and needs a fresh preview token plus confirmation. No arbitrary deletion or general settings-write tools are exposed.
- Analytics: first-party event analytics with consent, hashed identities and search-text controls. Docs-owner insights cover pages, channels, failed searches, feedback, AI crawler activity, AI referrals, and web vitals; self-hosters need optional ClickHouse and its ingestion/migrations. Crawler requests are not proof of training or citation. Unavailable data stays unknown. Assistant conversation, rating, content-gap and usage reports additionally depend on capture, consent, encryption-key configuration and ingestion; provider-reported cost may be unknown.
- Themes: Harbor, Manuscript, and Signal reader layouts with light/dark and RTL support, in the open-source code now, arriving in the next self-hosted release and on Nibleaf Cloud as it rolls out.
- Languages: English and Arabic authoring, RTL editor/reader behavior, per-language page trees, and hreflang for linked, enabled, indexable translations. There are 12 interface locale options, with some strings still in English.
- Git: two-way GitHub authoring with draft pull requests and immutable previews; GitLab and generic public Git imports are one-way.
- Exports: Markdown, static HTML, and PDF; daily, weekly, or monthly snapshot archive schedules with retention and private downloads. Export limits apply; content exports are not database backups.
- Reader sites: custom domains, private reader access, Scalar-powered OpenAPI references, changelog RSS, server-rendered pages, canonical metadata, sitemaps, and Markdown/llms discovery.
- Current gaps: no live multi-user co-editing, SAML/SCIM, or adaptive content.`;

const operations = `Nibleaf Cloud is free during the beta, with no card at sign-up. No paid cloud plan is offered today. No future price, date, or beta discount is committed here. No page or seat plan cap is published for the beta; fair-use safeguards, feature limits, and operator quotas still apply.

The self-hosted release provides public source and Docker Compose deployment configuration for the app, API, worker, PostgreSQL, cache, and object storage. Check actual release assets and prerequisites before installing. Operators manage DNS, TLS, backups, monitoring, upgrades, optional services, and recovery. S3-compatible storage is an instance-operator integration. Operators pay infrastructure and external-service costs; AI provider calls and configured storage or email services can send data outside the host.`;

export function marketingLlms(origin: string): string {
  return `# Nibleaf

> Documentation with a visual Markdown editor, publishing, search, Arabic/RTL, a free cloud beta, and self-hosting.

Last reviewed: 2026-11-07

${capabilities}

${operations}

## Pages and agent access

- [Home](${origin}/_index.md)
- [Arabic home](${origin}/ar.md)
- [Pricing](${origin}/pricing.md)
- [Self-hosting](${origin}/self-hosting.md)
- [English guides](${origin}/guides.md)
- [Arabic guides](${origin}/ar/guides.md)
- [Platform comparison](${origin}/documentation-platforms.md)
- [Arabic platform comparison](${origin}/ar/documentation-platforms.md)
- [Developer resources](${origin}/developers.md)
- [Public reader OpenAPI](${origin}/openapi.json)
- [Product documentation](https://docs.nibleaf.com)
- [Support MCP guide](https://docs.nibleaf.com/self-hosting/mcp)
- [Public source](https://github.com/lord007tn/nibleaf)
- [Full product description and public Markdown inventory](${origin}/llms-full.txt)

Request public pages with Accept: text/markdown or use their Markdown aliases. Read the public reader OpenAPI contract before calling reader endpoints. Authenticated support writing and confirmed publishing use the separately scoped MCP; dashboard session endpoints are not a supported third-party write contract. Published sites have their own llms.txt, llms-full.txt and sitemap.xml. Follow the inventory instead of guessing a missing route.
`;
}

export function marketingLlmsFull(origin: string): string {
  return `# Nibleaf — full description

Last reviewed: 2026-11-07

${capabilities}

## Cloud and self-hosting

${operations}

## Product documentation

- [Authoring](https://docs.nibleaf.com/product/authoring)
- [Ask AI](https://docs.nibleaf.com/product/ai-assistant)
- [Support MCP](https://docs.nibleaf.com/product/ai-assistants)
- [Search and AI configuration](https://docs.nibleaf.com/self-hosting/search-ai)
- [Analytics](https://docs.nibleaf.com/product/analytics)
- [ClickHouse setup](https://docs.nibleaf.com/self-hosting/clickhouse-analytics)
- [Themes](https://docs.nibleaf.com/product/themes)
- [Git authoring](https://docs.nibleaf.com/git-authoring)
- [Exports](https://docs.nibleaf.com/product/exports)
- [Backups and upgrades](https://docs.nibleaf.com/self-hosting/backups-upgrades)
- [Pricing](${origin}/pricing.md)
- [Public source](https://github.com/lord007tn/nibleaf)

## Public Markdown source inventory

Generated from the public marketing sitemap registry. The list describes source URLs; runtime access and publication still depend on the serving deployment.

${marketingMarkdownSourceUrls(origin)
  .map((url) => `- ${url}`)
  .join('\n')}
`;
}

export function marketingPricingMarkdown(origin: string): string {
  return `# Nibleaf pricing

Last reviewed: 2026-11-07

${operations}

## Capabilities and prerequisites

${capabilities}

## العربية

Nibleaf Cloud مجاني خلال المرحلة التجريبية، ولا يتطلب التسجيل بطاقة دفع. لا تتوفر خطة سحابية مدفوعة اليوم. تتوفر الاستضافة الذاتية بترخيص AGPL-3.0، ويتحمل المشغّل تكاليف البنية التحتية والخدمات الخارجية وصيانتها.

For the human-readable plan comparison, see ${origin}/pricing. Sign up at ${origin}/sign-up or review ${origin}/self-hosting before deploying your own instance.
`;
}
