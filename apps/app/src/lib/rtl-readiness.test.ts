import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseAndGradeRtlHtml, RTL_RUBRIC_VERSION } from './rtl-readiness';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../../../../fixtures/rtl-readiness/${name}.html`, import.meta.url)), 'utf8');
const expected = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/rtl-readiness/expected.json', import.meta.url)), 'utf8')) as {
  rubricVersion: string;
  fixtures: Record<string, { band: string; checksRun: number; checksUnknown: number; coverage: number; failedChecks: string[]; score: number }>;
};
const grade = (name: string) => {
  const source = fixture(name);
  return parseAndGradeRtlHtml(source);
};

describe('RTL readiness rubric fixtures', () => {
  it.each(['strong', 'gaps', 'ambiguous'])('matches the published expected summary for %s', (name) => {
    const result = grade(name);
    const summary = expected.fixtures[name];

    expect(result.rubricVersion).toBe(expected.rubricVersion);
    expect({
      band: result.band,
      checksRun: result.checksRun,
      checksUnknown: result.checksUnknown,
      coverage: result.coverage,
      failedChecks: result.checks.filter((check) => check.status === 'fail').map((check) => check.id),
      score: result.score,
    }).toEqual(summary);
  });

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
