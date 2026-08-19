import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { gradeRtlDocument, RTL_RUBRIC_VERSION } from './rtl-readiness';

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`../../../../fixtures/rtl-readiness/${name}.html`, import.meta.url)), 'utf8');
const expected = JSON.parse(readFileSync(fileURLToPath(new URL('../../../../fixtures/rtl-readiness/expected.json', import.meta.url)), 'utf8')) as {
  rubricVersion: string;
  fixtures: Record<string, { band: string; checksRun: number; checksUnknown: number; coverage: number; failedChecks: string[]; score: number }>;
};
const grade = (name: string) => {
  const source = fixture(name);
  const document = new JSDOM(source).window.document;
  return gradeRtlDocument(document, source);
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
});
