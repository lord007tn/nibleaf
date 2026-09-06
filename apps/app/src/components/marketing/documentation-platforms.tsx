import { ExternalLink } from 'lucide-react';
import { MarketingShell, primaryButton } from '@/components/cloud-marketing';

const platforms = [
  {
    name: 'Nibleaf',
    bestFor: 'Teams that want a browser editor, Markdown ownership, multilingual page trees, and a choice between cloud and self-hosting.',
    arabic: 'Arabic interface, per-language trees, RTL reader and editor behavior, and an Arabic search tokenizer are product-level concerns.',
    model: 'Free cloud beta or AGPL-3.0 self-hosting.',
    caveat: 'The public product is younger than the established alternatives; verify the current release, migrations, backups, and support boundary.',
    sources: [
      { href: '/pricing', label: 'Pricing' },
      { href: 'https://github.com/lord007tn/nibleaf', label: 'Public source' },
    ],
  },
  {
    name: 'Mintlify',
    bestFor: 'Teams prioritizing a managed, polished developer-documentation experience and an established component vocabulary.',
    arabic:
      'The product documents internationalization; evaluate navigation direction, search, mixed-direction code, and authoring with your corpus.',
    model: 'Managed commercial platform.',
    caveat: 'Confirm the plan, collaboration, export, and localization limits that apply to your account rather than inferring them from examples.',
    sources: [
      { href: 'https://www.mintlify.com/docs/guides/internationalization', label: 'Internationalization' },
      { href: 'https://www.mintlify.com/pricing', label: 'Pricing' },
    ],
  },
  {
    name: 'GitBook',
    bestFor: 'Cross-functional teams that want managed collaboration, change requests, and published knowledge spaces.',
    arabic: 'Variants can represent languages; test the complete interface locale, RTL layout, search, and version behavior in a trial space.',
    model: 'Managed commercial platform with Git synchronization options.',
    caveat: 'Separate site variants, interface localization, and bidirectional rendering in the evaluation—one does not prove the others.',
    sources: [
      { href: 'https://gitbook.com/docs/publishing-documentation/site-structure/variants', label: 'Variants' },
      { href: 'https://www.gitbook.com/pricing', label: 'Pricing' },
    ],
  },
  {
    name: 'Docusaurus',
    bestFor: 'Engineering teams comfortable with Git, React, builds, and deployment ownership.',
    arabic: 'Docusaurus documents locale direction and separate locale builds; the team still owns search, fonts, QA, and editorial parity.',
    model: 'Open-source static-site generator operated by your team.',
    caveat: 'The software license does not remove the staffing cost of authoring workflow, upgrades, hosting, search, and incident response.',
    sources: [{ href: 'https://docusaurus.io/docs/i18n/introduction', label: 'Official i18n docs' }],
  },
  {
    name: 'Material for MkDocs',
    bestFor: 'Python-oriented teams that prefer Markdown, Git review, and a static publishing pipeline.',
    arabic: 'The theme documents language and direction configuration; verify plugins, search tokenization, code isolation, and mobile navigation.',
    model: 'Open-source generator and theme operated by your team.',
    caveat: 'Plugin selection and translation workflow become part of your maintained platform, including compatibility during upgrades.',
    sources: [{ href: 'https://squidfunk.github.io/mkdocs-material/setup/changing-the-language/', label: 'Language setup' }],
  },
  {
    name: 'Apidog',
    bestFor: 'API teams that want specification authoring, testing, mocking, and published reference in one workflow.',
    arabic: 'Evaluate Arabic prose and RTL rendering separately from API-console behavior, where methods, paths, JSON, and code remain LTR.',
    model: 'Managed API development and documentation product.',
    caveat: 'Verify OpenAPI version fidelity, credential safety, browser CORS, export behavior, and pricing for the intended team size.',
    sources: [{ href: 'https://apidog.com/ar/blog/documentation-tools-ar/', label: 'Product article' }],
  },
];

export function DocumentationPlatformsPage({ stars = 0 }: { stars?: number }) {
  return (
    <MarketingShell stars={stars}>
      <article>
        <header className="border-border border-b">
          <div className="mx-auto max-w-4xl px-6 py-20">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-medium text-primary text-sm">Platform evaluation</p>
              <a className="text-muted-foreground text-sm underline underline-offset-4" href="/ar/documentation-platforms" hrefLang="ar">
                العربية
              </a>
            </div>
            <h1 className="mt-4 text-balance font-semibold text-4xl leading-tight tracking-tight sm:text-5xl">
              Documentation platforms for Arabic and multilingual teams
            </h1>
            <p className="mt-6 text-lg text-muted-foreground leading-8">
              Compare authoring, ownership, operating model, and Arabic/RTL verification needs before choosing a platform. The table is a decision
              aid, not a universal ranking.
            </p>
            <p className="mt-5 border-border border-t pt-5 text-muted-foreground text-sm leading-7">
              Reviewed on September 3, 2026 from linked public product documentation. Plans and product behavior can change; verify material
              constraints in a representative trial. Nibleaf is our product and is labelled accordingly below.
            </p>
          </div>
        </header>

        <section className="mx-auto max-w-4xl px-6 py-16">
          <h2 className="font-semibold text-3xl tracking-tight">Comparison method</h2>
          <p className="mt-5 text-muted-foreground leading-8">
            Start with the writing workflow and source of truth, then test publishing, search, versioning, access, export, and recovery. For Arabic,
            use real mixed-direction content and query judgments instead of treating an RTL screenshot as complete support.
          </p>
          <div className="mt-8 overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[52rem] text-sm">
              <caption className="sr-only">Documentation platform operating-model and Arabic-support comparison</caption>
              <thead>
                <tr className="border-border border-b bg-muted/50">
                  <th className="px-4 py-3 text-start">Platform</th>
                  <th className="px-4 py-3 text-start">Best fit to test</th>
                  <th className="px-4 py-3 text-start">Arabic and RTL</th>
                  <th className="px-4 py-3 text-start">Operating model</th>
                </tr>
              </thead>
              <tbody>
                {platforms.map((platform) => (
                  <tr className="border-border border-b align-top last:border-0" key={platform.name}>
                    <th className="px-4 py-4 text-start font-medium">{platform.name}</th>
                    <td className="px-4 py-4 text-muted-foreground leading-6">{platform.bestFor}</td>
                    <td className="px-4 py-4 text-muted-foreground leading-6">{platform.arabic}</td>
                    <td className="px-4 py-4 text-muted-foreground leading-6">{platform.model}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="border-border border-y bg-card/40">
          <div className="mx-auto max-w-4xl px-6 py-16">
            <h2 className="font-semibold text-3xl tracking-tight">Read the evidence and test the caveat</h2>
            <div className="mt-10 space-y-6">
              {platforms.map((platform) => (
                <section className="rounded-xl border border-border bg-background p-7" key={platform.name}>
                  <div className="flex flex-wrap items-center gap-3">
                    <h3 className="font-semibold text-xl">{platform.name}</h3>
                    {platform.name === 'Nibleaf' ? (
                      <span className="rounded-full bg-primary px-2.5 py-1 text-primary-foreground text-xs">Our product</span>
                    ) : null}
                    {platform.sources.map((source) => {
                      const external = source.href.startsWith('http');
                      return (
                        <a
                          className="inline-flex items-center gap-1 text-muted-foreground text-xs underline underline-offset-2"
                          href={source.href}
                          key={source.href}
                          rel={external ? 'noopener noreferrer' : undefined}
                          target={external ? '_blank' : undefined}
                        >
                          {source.label} {external ? <ExternalLink className="size-3" /> : null}
                        </a>
                      );
                    })}
                  </div>
                  <p className="mt-4 text-muted-foreground leading-8">{platform.bestFor}</p>
                  <p className="mt-4 text-sm leading-7">
                    <strong>Verify:</strong> <span className="text-muted-foreground">{platform.caveat}</span>
                  </p>
                </section>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-6 py-16">
          <h2 className="font-semibold text-3xl tracking-tight">A representative evaluation fixture</h2>
          <div className="mt-6 grid gap-4 text-muted-foreground leading-7 sm:grid-cols-2">
            <p className="rounded-xl border border-border p-5">
              Publish one conceptual guide, one API reference, one long table, one diagram, and one page with reusable components.
            </p>
            <p className="rounded-xl border border-border p-5">
              Round-trip Markdown through import, visual editing, export, Git diff, and re-import; record semantic loss rather than cosmetic line
              churn.
            </p>
            <p className="rounded-xl border border-border p-5">
              Repeat the page tree in English and Arabic with Arabic slugs, mixed digits, inline code, long navigation labels, and mobile viewports.
            </p>
            <p className="rounded-xl border border-border p-5">
              Test anonymous and authenticated HTML, Markdown, search, assets, exports, redirects, backups, restore, and rollback at the exact release
              identity.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-6 pb-24">
          <div className="rounded-2xl bg-foreground px-8 py-14 text-center text-background">
            <h2 className="font-semibold text-3xl tracking-tight">Choose from evidence you can repeat</h2>
            <p className="mx-auto mt-4 max-w-2xl text-background/75 leading-7">
              Run the same fixture in every serious candidate and keep failures, unknowns, operating work, and commercial constraints beside feature
              results.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <a className={primaryButton} href="/guides">
                Open the guide academy
              </a>
              <a
                className="inline-flex h-11 items-center rounded-md border border-background/30 px-5 font-medium text-sm hover:bg-background/10"
                href="/blog/open-source-documentation-tools"
              >
                Read the open-source evaluation
              </a>
            </div>
          </div>
        </section>
      </article>
    </MarketingShell>
  );
}
