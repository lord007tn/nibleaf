import { describe, expect, it } from 'vitest';
import { parseAndGradeRtlHtml, RTL_RUBRIC_VERSION } from './rtl-readiness';

const samples = {
  strong: `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><meta name="description" content="دليل عربي لاختبار اتجاه وثائق المنتج والبحث والشيفرة."/><meta property="og:locale" content="ar_AR"/><title>اختبار وثائق المنتج العربية</title><link rel="canonical" href="https://docs.example.com/ar/test"/><link rel="alternate" hreflang="ar" href="https://docs.example.com/ar/test"/><link rel="alternate" hreflang="en" href="https://docs.example.com/en/test"/><link rel="alternate" hreflang="x-default" href="https://docs.example.com/en/test"/><style>:not(pre)>code{direction:ltr;unicode-bidi:isolate}pre{direction:ltr;text-align:left}.table-scroll{overflow-x:auto}:focus-visible{outline:2px solid currentColor}@media(max-width:48rem){aside{position:static}}</style></head><body><a href="#content">تخط إلى المحتوى</a><nav aria-label="التنقل الرئيسي"><a href="/ar/test">الاختبار</a></nav><nav aria-label="breadcrumb" data-breadcrumb><a href="/ar">الرئيسية</a></nav><main id="content"><h1>اختبار وثائق المنتج العربية</h1><p>شغّل <code>docker compose up -d</code>.</p><label for="search">البحث</label><input id="search" type="search" placeholder="ابحث في التوثيق"/><pre><code>curl https://docs.example.com</code></pre><div class="table-scroll"><table><tr><th>المعامل</th><td><code>user_id</code></td></tr></table></div><figure><img alt="نتيجة البحث العربية" src="result.png"/><figcaption>نتيجة متوقعة</figcaption></figure><button type="button" aria-label="فتح القائمة">☰</button></main></body></html>`,
  gaps: `<!doctype html><html lang="en"><head><meta name="description" content="English-only metadata"/><meta property="og:locale" content="en_US"/><title>Documentation test</title><link rel="canonical" href="/relative"/></head><body><nav><a href="/">الرئيسية</a></nav><main><p>شغّل <code>docker compose up -d</code>.</p><pre><code>curl https://docs.example.com</code></pre><table><tr><td>قيمة</td></tr></table><img src="result.png"/><button type="button"></button></main></body></html>`,
  ambiguous: `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/><title>صفحة عربية أولية</title></head><body><main><h1>صفحة عربية أولية</h1><p>لا تحتوي هذه العينة على مكونات اختيارية يمكن فحصها.</p></main></body></html>`,
};
const grade = (name: keyof typeof samples) => parseAndGradeRtlHtml(samples[name]);

describe('RTL readiness rubric samples', () => {
  it('returns strong static evidence while preserving rendered checks as unknown', () => {
    const result = grade('strong');

    expect(result.rubricVersion).toBe(RTL_RUBRIC_VERSION);
    expect(result.score).toBe(100);
    expect(result.coverage).toBe(77);
    expect(result.band).toBe('strong evidence');
    expect(result.checks.filter((check) => check.status === 'fail')).toHaveLength(0);
    expect(result.checksUnknown).toBeGreaterThan(0);
  });

  it('reports explicit defects as failures with reproduction evidence', () => {
    const result = grade('gaps');
    const failures = result.checks.filter((check) => check.status === 'fail');

    expect(result.band).toBe('material gaps');
    expect(result.score).toBeLessThan(50);
    expect(failures.length).toBeGreaterThan(10);
    expect(failures.every((check) => check.actual && check.expected && check.reproduction)).toBe(true);
  });

  it('does not convert missing optional samples into failures or zero', () => {
    const result = grade('ambiguous');
    const codeCheck = result.checks.find((check) => check.id === 'inline-code-isolation');
    const mediaCheck = result.checks.find((check) => check.id === 'media-alternatives');

    expect(result.band).toBe('insufficient evidence');
    expect(codeCheck?.status).toBe('unknown');
    expect(mediaCheck?.status).toBe('unknown');
    expect(result.score).not.toBe(0);
  });

  it('keeps scripts and remote resources inert while parsing untrusted HTML', () => {
    const marker = '__nibleaf_rtl_grader_script_ran__';
    const scope = globalThis as typeof globalThis & Record<string, unknown>;
    delete scope[marker];

    expect(() =>
      parseAndGradeRtlHtml(
        `<html lang="ar" dir="rtl"><body><script>globalThis.${marker}=true</script><img src="https://example.invalid/pixel"></body></html>`,
      ),
    ).not.toThrow();
    expect(scope[marker]).toBeUndefined();
  });

  it('recognizes Arabic search and breadcrumb accessible names', () => {
    const result = parseAndGradeRtlHtml(`
      <html lang="ar" dir="rtl"><body>
        <nav aria-label="مسار التنقل"><a href="/ar">الرئيسية</a></nav>
        <button aria-label="البحث"></button>
      </body></html>`);

    expect(result.checks.find((check) => check.id === 'breadcrumbs')?.status).toBe('pass');
    expect(result.checks.find((check) => check.id === 'search-interface')?.status).toBe('pass');
    expect(result.checks.find((check) => check.id === 'arabic-search-prompt')?.status).toBe('pass');
  });

  it('requires a scrollable table ancestor and rejects overflow hidden', () => {
    const hidden = parseAndGradeRtlHtml('<html><body><div class="overflow-hidden"><table><tr><td>x</td></tr></table></div></body></html>');
    const scrollable = parseAndGradeRtlHtml(
      '<html><head><style>.table-scroll { overflow-x: auto; }</style></head><body><div class="table-scroll"><table><tr><td>x</td></tr></table></div></body></html>',
    );

    expect(hidden.checks.find((check) => check.id === 'table-overflow')?.status).toBe('fail');
    expect(scrollable.checks.find((check) => check.id === 'table-overflow')?.status).toBe('pass');
  });

  it('checks figure captions while accepting implicit labels and ignoring hidden inputs', () => {
    const result = parseAndGradeRtlHtml(`
      <html><body>
        <figure><img alt="نتيجة الاختبار" src="result.png"></figure>
        <label>البحث <input type="search"></label>
        <input type="hidden" value="internal">
      </body></html>`);

    expect(result.checks.find((check) => check.id === 'media-alternatives')?.status).toBe('fail');
    expect(result.checks.find((check) => check.id === 'control-labels')?.status).toBe('pass');
  });
});
