import { Button } from '@nibleaf/design-system/components/ui/button';
import { Textarea } from '@nibleaf/design-system/components/ui/textarea';
import { createFileRoute } from '@tanstack/react-router';
import { AlertTriangle, ArrowRight, CheckCircle2, Clipboard, HelpCircle, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Eyebrow, MarketingShell, outlineButton, primaryButton } from '@/components/cloud-marketing';
import { trackMarketingEvent } from '@/lib/marketing-events';
import { breadcrumbLd, canonicalHref, getGithubStars, pageMeta } from '@/lib/marketing-seo';
import { parseAndGradeRtlHtml, RTL_RUBRIC_VERSION, type RtlReadinessResult } from '@/lib/rtl-readiness';

const TOOL_PATH = '/tools/rtl-documentation-readiness';
const TOOL_SLUG = 'rtl-documentation-readiness';
const RESULT_EVENT_TYPES = {
  'insufficient evidence': 'insufficient_evidence',
  'material gaps': 'material_gaps',
  'strong evidence': 'strong_evidence',
  'work remaining': 'work_remaining',
} as const;

export const Route = createFileRoute('/tools/rtl-documentation-readiness')({
  loader: async () => ({ stars: await getGithubStars() }),
  head: () => ({
    meta: pageMeta({
      title: 'Free RTL documentation readiness grader | Nibleaf',
      description:
        'Paste HTML and get a private, browser-only RTL documentation readiness report with transparent checks, unknowns, and reproduction steps.',
      path: TOOL_PATH,
    }),
    links: [{ rel: 'canonical', href: canonicalHref(TOOL_PATH) }],
    scripts: [
      breadcrumbLd([
        { name: 'Home', path: '/' },
        { name: 'RTL documentation readiness grader', path: TOOL_PATH },
      ]),
    ],
  }),
  component: RtlDocumentationReadinessPage,
});

const SAMPLE_HTML = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="description" content="دليل عربي لاختبار وثائق المنتج.">
  <meta property="og:locale" content="ar_AR">
  <title>اختبار وثائق المنتج العربية</title>
  <link rel="canonical" href="https://docs.example.com/ar/test">
  <link rel="alternate" hreflang="ar" href="https://docs.example.com/ar/test">
  <link rel="alternate" hreflang="en" href="https://docs.example.com/en/test">
  <link rel="alternate" hreflang="x-default" href="https://docs.example.com/en/test">
  <style>
    :not(pre) > code { direction: ltr; unicode-bidi: isolate; }
    pre { direction: ltr; text-align: left; }
    @media (max-width: 48rem) { nav { position: static; } }
  </style>
</head>
<body>
  <a href="#content">تخط إلى المحتوى</a>
  <nav aria-label="التنقل الرئيسي"><a href="/ar/test">الاختبار</a></nav>
  <main id="content">
    <h1>اختبار وثائق المنتج العربية</h1>
    <p>شغّل <code>docker compose up -d</code> ثم افتح <code>/docs?v=2</code>.</p>
    <label for="search">البحث</label>
    <input id="search" type="search" placeholder="ابحث في التوثيق">
    <pre><code>curl https://docs.example.com</code></pre>
  </main>
</body>
</html>`;

function RtlDocumentationReadinessPage() {
  const { stars } = Route.useLoaderData();
  const [html, setHtml] = useState(SAMPLE_HTML);
  const [result, setResult] = useState<RtlReadinessResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  const analyze = () => {
    trackMarketingEvent('free_tool_started', {
      input_mode: 'html',
      page_path: TOOL_PATH,
      product: 'nibleaf',
      rubric_version: RTL_RUBRIC_VERSION,
      tool_slug: TOOL_SLUG,
    });
    const next = parseAndGradeRtlHtml(html);
    setResult(next);
    setCopied(false);
    setCopyError(null);
    trackMarketingEvent('free_tool_completed', {
      category_count: next.categories.length,
      checks_run: next.checksRun,
      checks_unknown: next.checksUnknown,
      product: 'nibleaf',
      result_type: RESULT_EVENT_TYPES[next.band],
      rubric_version: next.rubricVersion,
      tool_slug: TOOL_SLUG,
    });
  };

  const copyResult = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
      setCopied(true);
      setCopyError(null);
    } catch {
      setCopied(false);
      setCopyError('Clipboard access was unavailable. Open the full check list and copy the result manually.');
    }
  };

  const trackCta = (destination: 'sample_project_signup' | 'fixture_corpus', placement: 'result_bridge') =>
    trackMarketingEvent('free_tool_cta_clicked', {
      destination,
      placement,
      product: 'nibleaf',
      tool_slug: TOOL_SLUG,
    });

  return (
    <MarketingShell stars={stars}>
      <section className="border-border border-b">
        <div className="mx-auto max-w-4xl px-6 py-16 text-center sm:py-20">
          <div className="flex justify-center">
            <Eyebrow>Free browser tool</Eyebrow>
          </div>
          <h1 className="mt-4 text-balance font-semibold text-4xl tracking-tight sm:text-5xl">RTL documentation readiness grader</h1>
          <p className="mx-auto mt-4 max-w-3xl text-balance text-lg text-muted-foreground leading-relaxed">
            Paste a page's HTML to inspect Arabic language signals, bidi code handling, search controls, navigation, semantics, and mobile-readiness
            evidence.
          </p>
          <div className="mx-auto mt-6 flex max-w-2xl items-start gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/8 p-4 text-start text-sm">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <p>
              <strong>Your HTML stays in this browser.</strong> The grader does not upload, store, or include submitted content or URLs in analytics.
            </p>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-8 px-6 py-14 lg:grid-cols-[1.05fr_0.95fr]">
        <div>
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="font-semibold text-2xl tracking-tight">Paste the initial HTML response</h2>
              <p className="mt-1 text-muted-foreground text-sm">Use View Source where possible. DOM copied after hydration may hide SSR defects.</p>
            </div>
            <span className="shrink-0 rounded-full border border-border px-2.5 py-1 font-mono text-muted-foreground text-xs">
              rubric {RTL_RUBRIC_VERSION}
            </span>
          </div>
          <Textarea
            aria-label="HTML to analyze"
            className="mt-5 min-h-[34rem] resize-y font-mono text-xs leading-relaxed"
            onChange={(event) => setHtml(event.target.value)}
            spellCheck={false}
            value={html}
          />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button className="h-11 px-5" disabled={!html.trim()} onClick={analyze} type="button">
              Analyze HTML
            </Button>
            <button
              className={outlineButton}
              onClick={() => {
                setHtml(SAMPLE_HTML);
                setResult(null);
              }}
              type="button"
            >
              Restore sample
            </button>
          </div>
        </div>

        <div aria-live="polite">
          {result ? <ResultPanel copyError={copyError} onCopy={copyResult} copied={copied} result={result} /> : <EmptyResult />}
        </div>
      </section>

      <section className="border-border border-y bg-card/40">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <h2 className="font-semibold text-3xl tracking-tight">What this score can—and cannot—prove</h2>
          <div className="mt-8 grid gap-5 md:grid-cols-2">
            <EvidenceCard
              title="Deterministic evidence"
              items={[
                'Root language and direction',
                'Canonical and hreflang set',
                'Arabic metadata',
                'Code direction and bidi isolation',
                'Landmarks, labels, viewport, and static responsive evidence',
              ]}
            />
            <EvidenceCard
              title="Reported as unknown"
              items={[
                'Rendered sidebar and icon direction',
                'Arabic tokenizer, morphology, and ranking',
                'Keyboard focus order and visible focus',
                'API try-it interaction',
                'Actual overflow and usability at 390 px',
              ]}
            />
          </div>
          <p className="mt-6 text-muted-foreground text-sm leading-relaxed">
            Unknowns never become failures or zero. A complete review combines this static report with the open fixture corpus, browser checks, and
            real search queries.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-16">
        <div className="rounded-2xl border border-border bg-foreground px-8 py-12 text-background sm:px-12">
          <h2 className="font-semibold text-3xl tracking-tight">Test the same workflow in a bilingual project</h2>
          <p className="mt-3 max-w-2xl text-background/75 leading-relaxed">
            Create one Arabic page, include a command and path, publish it manually, then compare the live HTML and search results with this report.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a
              className={`${primaryButton} group`}
              href="/sign-up?utm_source=rtl_grader&utm_medium=free_tool&utm_campaign=rtl_readiness"
              onClick={() => trackCta('sample_project_signup', 'result_bridge')}
            >
              Create a sample project <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
            </a>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}

function EmptyResult() {
  return (
    <div className="flex min-h-[34rem] flex-col items-center justify-center rounded-2xl border border-border border-dashed bg-card/30 p-8 text-center">
      <HelpCircle className="size-10 text-muted-foreground" />
      <h2 className="mt-4 font-semibold text-xl">Your evidence report appears here</h2>
      <p className="mt-2 max-w-sm text-muted-foreground text-sm">
        The included sample demonstrates the input format. Replace it with a real initial HTML response when you are ready.
      </p>
    </div>
  );
}

function ResultPanel({
  copied,
  copyError,
  onCopy,
  result,
}: {
  copied: boolean;
  copyError: string | null;
  onCopy: () => void;
  result: RtlReadinessResult;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-medium text-muted-foreground text-xs uppercase tracking-wider">Static evidence score</p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-semibold text-5xl tracking-tight">{result.score ?? '—'}</span>
            <span className="text-muted-foreground">/ 100 known evidence</span>
          </div>
          <p className="mt-2 font-medium capitalize">{result.band}</p>
        </div>
        <button className={outlineButton} onClick={onCopy} type="button">
          <Clipboard className="size-4" /> {copied ? 'Copied' : 'Copy JSON'}
        </button>
      </div>
      {copyError ? <p className="mt-3 text-amber-700 text-sm dark:text-amber-300">{copyError}</p> : null}
      <div className="mt-6 grid grid-cols-3 gap-3 text-center text-sm">
        <Metric value={`${result.coverage}%`} label="rubric covered" />
        <Metric value={String(result.checksRun)} label="checks scored" />
        <Metric value={String(result.checksUnknown)} label="unknown" />
      </div>
      <div className="mt-7 space-y-3">
        {result.categories.map((category) => (
          <div className="rounded-lg border border-border bg-background p-4" key={category.id}>
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-medium text-sm">{category.label}</h3>
              <span className="font-mono text-muted-foreground text-xs">{category.score ?? '—'} / 100</span>
            </div>
            <p className="mt-1 text-muted-foreground text-xs">
              {category.knownWeight}/{category.totalWeight} weight scored · {category.unknownChecks} unknown
            </p>
          </div>
        ))}
      </div>
      <details className="mt-6 rounded-lg border border-border bg-background px-4" open>
        <summary className="cursor-pointer py-4 font-medium text-sm">All checks and reproduction steps</summary>
        <div className="divide-y divide-border border-border border-t">
          {result.checks.map((check) => (
            <CheckRow check={check} key={check.id} />
          ))}
        </div>
      </details>
    </div>
  );
}

function CheckRow({ check }: { check: RtlReadinessResult['checks'][number] }) {
  const Icon = check.status === 'pass' ? CheckCircle2 : check.status === 'fail' ? AlertTriangle : HelpCircle;
  const color =
    check.status === 'pass'
      ? 'text-emerald-600 dark:text-emerald-400'
      : check.status === 'fail'
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-muted-foreground';
  return (
    <div className="py-4 text-sm">
      <div className="flex items-start gap-2">
        <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${color}`} />
        <span className="sr-only">Status: {check.status}</span>
        <div>
          <p className="font-medium">{check.id}</p>
          <p className="mt-1 text-muted-foreground">{check.actual}</p>
        </div>
      </div>
      <div className="mt-3 space-y-1 ps-6 text-xs">
        <p>
          <strong>Expected:</strong> {check.expected}
        </p>
        <p>
          <strong>Reproduce:</strong> {check.reproduction}
        </p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <p className="font-semibold text-lg">{value}</p>
      <p className="mt-0.5 text-muted-foreground text-xs">{label}</p>
    </div>
  );
}

function EvidenceCard({ items, title }: { items: string[]; title: string }) {
  return (
    <div className="rounded-xl border border-border bg-background p-6">
      <h3 className="font-semibold text-lg">{title}</h3>
      <ul className="mt-4 space-y-2 text-muted-foreground text-sm">
        {items.map((item) => (
          <li className="flex gap-2" key={item}>
            <span className="text-primary">•</span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
