import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenRouter } from '@openrouter/sdk';
import type { Model } from '@openrouter/sdk/models';
import { z } from 'zod';
import { boundChatHistory, condenseFollowUp, streamGroundedChat } from '../src/answer-chat';
import { validateCitedAnswer } from '../src/answer-validation';
import { generateGroundedAnswer, type SearchChunk } from '../src/index';
import { type ChatUsage, OpenRouterChatProvider } from '../src/providers';
import { type ChatCostSink, workspaceChatAdapter, workspaceChatModelOptions } from '../src/workspace';
import type { Fixture } from './build-docs-fixtures';

const here = dirname(fileURLToPath(import.meta.url));
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey && process.env.EVAL_CATALOG_ONLY !== '1') throw new Error('OPENROUTER_API_KEY is required; credentials are never printed.');
const client = new OpenRouter({ apiKey, timeoutMs: 60_000 });
const catalog: Model[] = [];
for await (const page of await client.models.list()) catalog.push(...page.result.data);
const list = (value: string) => [
  ...new Set(
    value
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  ),
];
const defaults = [...new Set([...catalog.filter((m) => /luna|terra/i.test(m.id)).map((m) => m.id), 'openai/gpt-5.6-luna'])];
const models = list(process.env.EVAL_MODELS ?? process.env.OPENROUTER_EVAL_MODELS ?? defaults.join(','));
const condenseModels = list(process.env.EVAL_CONDENSE_MODELS ?? '');
const judgeModel =
  process.env.EVAL_JUDGE_MODEL ??
  catalog.find((m) => m.id === 'openai/gpt-6.1-terra')?.id ??
  catalog.find((m) => m.id.includes('terra') && !m.id.includes(':'))?.id;
if (!judgeModel) throw new Error('No default terra judge found; set EVAL_JUDGE_MODEL to a live catalog ID.');
for (const id of [...models, ...condenseModels, judgeModel])
  if (!catalog.some((m) => m.id === id)) throw new Error(`Requested model absent from live catalog: ${id}`);
const pricing = (id: string) => catalog.find((m) => m.id === id)?.pricing;
console.log(JSON.stringify({ resolvedModels: models.map((id) => ({ id, pricing: pricing(id) })), judgeModel, condenseModels }, null, 2));
if (process.env.EVAL_CATALOG_ONLY === '1') process.exit(0);
const positiveInt = (name: string, fallback: number) => {
  const v = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(v) || v < 1) throw new Error(`${name} must be a positive integer`);
  return v;
};
const concurrency = positiveInt('EVAL_CONCURRENCY', 2);
const limit = positiveInt('EVAL_LIMIT', Number.MAX_SAFE_INTEGER);
const fixtureSet = process.env.EVAL_FIXTURES ?? 'all';
if (!['legacy', 'docs', 'all'].includes(fixtureSet)) throw new Error('EVAL_FIXTURES must be legacy, docs, or all');
const fixtureFiles =
  fixtureSet === 'all'
    ? ['rag-answer-fixtures.json', 'nibleaf-docs-fixtures.json']
    : [fixtureSet === 'docs' ? 'nibleaf-docs-fixtures.json' : 'rag-answer-fixtures.json'];
const fixtures: Fixture[] = (
  await Promise.all(fixtureFiles.map(async (file) => JSON.parse(await readFile(resolve(here, '../eval', file), 'utf8')) as Fixture[]))
)
  .flat()
  .slice(0, limit);
const evalMode = process.env.EVAL_MODE ?? 'both';
if (!['strict', 'chat', 'both'].includes(evalMode)) throw new Error('EVAL_MODE must be strict, chat, or both');
const modes: ('strict' | 'chat')[] = evalMode === 'both' ? ['strict', 'chat'] : [evalMode as 'strict' | 'chat'];
const rubric = await readFile(resolve(here, '../eval/judge-rubric.md'), 'utf8');
const evidenceHashes = Object.fromEntries(
  await Promise.all(
    [
      '../src/answer-chat.ts',
      '../src/answer-validation.ts',
      '../src/workspace.ts',
      '../eval/judge-rubric.md',
      ...fixtureFiles.map((f) => `../eval/${f}`),
    ].map(async (file) => [
      file,
      createHash('sha256')
        .update(await readFile(resolve(here, file)))
        .digest('hex'),
    ]),
  ),
);
const normalize = (s: string) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u064b-\u065f\u0670\u0640]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
const chunks = (f: Fixture): SearchChunk[] =>
  f.sources.map((s, i) => ({
    ...s,
    id: `${f.id}-${i}`,
    pageId: `${f.id}-${i}`,
    ordinal: i,
    description: '',
    headingPath: [s.heading],
    contentHash: `fixture-${i}`,
    language: f.language,
    direction: f.language === 'en' ? 'ltr' : 'rtl',
    visible: true,
  }));
interface Spend {
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  costSource: 'reported' | 'estimated' | 'unknown';
}
const spend = (model: string, usage?: ChatUsage, sink?: ChatCostSink): Spend => {
  const reported = sink?.costUsd ?? usage?.costUsd;
  const p = pricing(model);
  const estimated =
    usage?.inputTokens !== undefined && usage.outputTokens !== undefined && p
      ? usage.inputTokens * Number(p.prompt) + usage.outputTokens * Number(p.completion)
      : undefined;
  return {
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    costUsd: reported ?? estimated,
    costSource: reported !== undefined ? 'reported' : estimated !== undefined ? 'estimated' : 'unknown',
  };
};
// Reserve a conservative byte-based bound before dispatch, including concurrent calls.
// Never reclaim reservations: missing usage or a failed request cannot hide spend.
let reservedUsd = 0;
const budget = Number(process.env.EVAL_MAX_COST_USD ?? Number.POSITIVE_INFINITY);
if (!(budget > 0)) throw new Error('EVAL_MAX_COST_USD must be positive');
function reserve(model: string, text: string, maxOutput: number) {
  const p = pricing(model);
  if (!p || !Number.isFinite(Number(p.prompt)) || !Number.isFinite(Number(p.completion))) throw new Error(`Unknown pricing: ${model}`);
  const amount = (Buffer.byteLength(text, 'utf8') + 4000) * Number(p.prompt) + maxOutput * Number(p.completion);
  if (reservedUsd + amount > budget) throw new Error('Evaluation spend reservation exceeds EVAL_MAX_COST_USD; no request dispatched.');
  reservedUsd += amount;
}
function runtime(model: string) {
  return {
    providerId: 'openrouter' as const,
    apiKey: apiKey as string,
    answerModel: model,
    embeddingModel: '',
    revision: 'eval',
    answersEnabled: true,
  };
}
const judgeSchema = z
  .object({
    correctness: z.number().int().min(1).max(5),
    helpfulness: z.number().int().min(1).max(5),
    formatting: z.number().int().min(1).max(5),
    languageQuality: z.number().int().min(1).max(5),
    reason: z.string(),
  })
  .strict();
type Judge = z.infer<typeof judgeSchema>;
interface Rewrite extends Spend {
  model: string;
  fixture: string;
  query: string;
  rewritten: boolean;
  topicMatch?: boolean;
  latencyMs: number;
}
interface RecordRow extends Spend {
  model: string;
  mode: 'chat' | 'strict';
  fixture: string;
  language: string;
  expectedNoAnswer: boolean;
  expectClarifying: boolean;
  error?: string;
  status?: string;
  answer?: string;
  citationIds?: string[];
  citationValidity?: number;
  citationHit?: number;
  citationAccuracy?: number;
  requiredClaimCoverage?: number;
  forbiddenClaims?: string[];
  noAnswerCorrect?: boolean;
  clarifyingAccuracy?: number;
  arabicLetterShare?: number;
  languageMatch?: number;
  ttftMs?: number;
  providerFirstTokenMs?: number;
  latencyMs?: number;
  judge?: Judge;
  judgeSpend?: Spend;
  judgeError?: string;
  rewrite?: Rewrite;
  droppedParagraphs?: number;
}
const records: RecordRow[] = [];
const rewrites: Rewrite[] = [];
const rewriteErrors: { model: string; fixture: string }[] = [];
async function rewrite(model: string, f: Fixture): Promise<Rewrite> {
  const history = boundChatHistory(f.history ?? [], { maxMessages: 6, maxTokens: 1500 });
  reserve(model, JSON.stringify({ history, question: f.question }), 120);
  const sink: ChatCostSink = {};
  const start = performance.now();
  const result = await condenseFollowUp({
    adapter: workspaceChatAdapter(runtime(model), sink),
    modelOptions: workspaceChatModelOptions(runtime(model)),
    question: f.question,
    history,
    language: f.language === 'mixed' ? 'ar' : f.language,
  });
  await Promise.all(sink.pending ?? []);
  return {
    model,
    fixture: f.id,
    query: result.query,
    rewritten: result.rewritten,
    topicMatch: f.rewriteTopicTerms?.length ? f.rewriteTopicTerms.some((t) => normalize(result.query).includes(normalize(t))) : undefined,
    latencyMs: performance.now() - start,
    ...spend(model, result.usage, sink),
  };
}
async function judge(f: Fixture, answer: string) {
  const input = JSON.stringify({
    question: f.question,
    history: f.history ?? [],
    language: f.language,
    sources: f.sources,
    expectedNoAnswer: f.expectedNoAnswer,
    expectClarifying: f.expectClarifying ?? false,
    answer,
  });
  reserve(judgeModel as string, rubric + input, 500);
  const response = await client.chat.send({
    chatRequest: {
      model: judgeModel as string,
      messages: [
        { role: 'system', content: rubric },
        { role: 'user', content: input },
      ],
      temperature: 0,
      maxTokens: 500,
      responseFormat: { type: 'json_object' },
    },
  });
  const content = response.choices[0]?.message.content;
  if (typeof content !== 'string') throw new Error('Judge returned no text');
  const scores = judgeSchema.parse(JSON.parse(content));
  const u = response.usage;
  return {
    scores,
    spend: spend(
      judgeModel as string,
      u ? { inputTokens: u.promptTokens, outputTokens: u.completionTokens, totalTokens: u.totalTokens, costUsd: u.cost ?? undefined } : undefined,
    ),
  };
}
async function evaluate(model: string, mode: 'strict' | 'chat', f: Fixture) {
  const row: RecordRow = {
    model,
    mode,
    fixture: f.id,
    language: f.language,
    expectedNoAnswer: f.expectedNoAnswer,
    expectClarifying: f.expectClarifying ?? false,
    costSource: 'unknown',
  };
  const start = performance.now();
  try {
    const sourceChunks = chunks(f);
    const sink: ChatCostSink = {};
    let raw = '';
    let ttft: number | undefined;
    if (mode === 'chat' && f.history?.length) row.rewrite = await rewrite(model, f);
    reserve(model, JSON.stringify(f), 1200);
    const answer =
      mode === 'strict'
        ? await generateGroundedAnswer(
            new OpenRouterChatProvider({ apiKey: apiKey as string, model, timeoutMs: 60_000, temperature: 0 }),
            f.question,
            sourceChunks,
            0.85,
            f.language === 'mixed' ? 'ar' : f.language,
          )
        : await (async () => {
            const streamStart = performance.now();
            const stream = streamGroundedChat({
              adapter: workspaceChatAdapter(runtime(model), sink),
              modelOptions: workspaceChatModelOptions(runtime(model)),
              model,
              question: f.question,
              history: f.history ?? [],
              chunks: sourceChunks,
              language: f.language === 'mixed' ? 'ar' : f.language,
              pageContext: f.pageContext,
            });
            for await (const delta of stream.deltas) {
              ttft ??= performance.now() - streamStart;
              raw += delta;
            }
            return stream.result;
          })();
    await Promise.all(sink.pending ?? []);
    Object.assign(row, spend(model, answer.usage, sink));
    row.status = answer.status;
    row.answer = answer.answer;
    row.latencyMs = performance.now() - start;
    row.ttftMs = ttft;
    if ('firstTokenMs' in answer) row.providerFirstTokenMs = answer.firstTokenMs;
    row.droppedParagraphs = 'droppedParagraphs' in answer ? answer.droppedParagraphs : 0;
    row.citationIds = answer.citations.map((c) => c.id);
    const validation = validateCitedAnswer(raw || answer.answer, sourceChunks, f.question, mode);
    row.citationValidity =
      answer.status === 'no_answer'
        ? 'validationFailure' in answer && answer.validationFailure
          ? 0
          : 1
        : Number(
            validation.status === 'answered' && row.citationIds.every((id) => /^S[1-9]\d*$/.test(id) && Number(id.slice(1)) <= sourceChunks.length),
          );
    const expected = f.expectedSourceHeadings;
    if (expected?.length) {
      const hits = answer.citations.filter((c) => expected.includes(c.heading ?? '')).length;
      row.citationHit = Number(hits > 0);
      row.citationAccuracy = answer.citations.length ? hits / answer.citations.length : 0;
    }
    row.noAnswerCorrect = f.expectedNoAnswer ? answer.status === 'no_answer' : answer.status === 'answered';
    const normalized = normalize(answer.answer);
    row.requiredClaimCoverage = f.requiredClaims.length
      ? f.requiredClaims.filter((c) => normalized.includes(normalize(c))).length / f.requiredClaims.length
      : undefined;
    row.forbiddenClaims = (f.forbiddenClaims ?? []).filter((c) => normalized.includes(normalize(c)));
    if (f.expectClarifying)
      row.clarifyingAccuracy = Number(/[?؟]/.test(answer.answer) && /\b(or|either)\b|(?:أم|أو)|(?:^|\n)\s*[-*1-9]/m.test(answer.answer));
    const prose = answer.answer.replace(/```[\s\S]*?```|`[^`]*`|\[S\d+\]|https?:\/\/\S+|\b\w*[A-Z_\d]\w*\b/g, '');
    const letters = (prose.match(/\p{L}/gu) ?? []).length;
    row.arabicLetterShare = letters ? (prose.match(/\p{Script=Arabic}/gu) ?? []).filter((c) => /\p{L}/u.test(c)).length / letters : undefined;
    row.languageMatch =
      row.arabicLetterShare === undefined ? undefined : Number(f.language === 'en' ? row.arabicLetterShare < 0.2 : row.arabicLetterShare >= 0.5);
    try {
      const judged = await judge(f, answer.answer);
      row.judge = judged.scores;
      row.judgeSpend = judged.spend;
    } catch {
      row.judgeError = 'Judge request or strict JSON validation failed';
    }
  } catch {
    row.error = 'Evaluation failed (provider, validation, or spend cap); no successful answer recorded';
  }
  records.push(row);
  console.log(`${mode} ${model} ${f.id}: ${row.error ?? row.status}${row.judgeError ? ' (judge failed)' : ''}`);
}
const jobs = models.flatMap((model) => modes.flatMap((mode) => fixtures.map((f) => () => evaluate(model, mode, f))));
for (const model of condenseModels)
  for (const f of fixtures.filter((f) => f.history?.length))
    jobs.push(async () => {
      try {
        rewrites.push(await rewrite(model, f));
      } catch {
        rewriteErrors.push({ model, fixture: f.id });
        console.error(`Rewrite failed: ${model} ${f.id}`);
      }
    });
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      if (job) await job();
    }
  }),
);
const mean = (v: (number | undefined)[]) => {
  const known = v.filter((n): n is number => n !== undefined);
  return known.length ? known.reduce((a, b) => a + b, 0) / known.length : undefined;
};
const percentile = (v: (number | undefined)[], p: number) => {
  const known = v.filter((n): n is number => n !== undefined).sort((a, b) => a - b);
  return known.length ? known[Math.ceil(p * known.length) - 1] : undefined;
};
function summarize(rows: RecordRow[]) {
  return {
    cases: rows.length,
    errors: rows.filter((r) => r.error).length,
    answerRate: mean(rows.filter((r) => !r.expectedNoAnswer).map((r) => Number(r.status === 'answered'))),
    noAnswerAccuracy: mean(rows.filter((r) => r.expectedNoAnswer).map((r) => Number(r.noAnswerCorrect ?? false))),
    clarifyingAccuracy: mean(rows.filter((r) => r.expectClarifying).map((r) => r.clarifyingAccuracy ?? 0)),
    citationValidity: mean(rows.map((r) => r.citationValidity ?? 0)),
    citationHit: mean(rows.map((r) => r.citationHit)),
    citationAccuracy: mean(rows.map((r) => r.citationAccuracy)),
    claimCoverage: mean(rows.map((r) => r.requiredClaimCoverage)),
    forbiddenClaimViolations: rows.reduce((n, r) => n + (r.forbiddenClaims?.length ?? 0), 0),
    judgeHelpfulness: mean(rows.map((r) => r.judge?.helpfulness)),
    judgeCount: rows.filter((r) => r.judge).length,
    arabicQuality: mean(rows.filter((r) => r.language !== 'en').map((r) => r.arabicLetterShare)),
    languageMatch: mean(rows.map((r) => r.languageMatch)),
    medianTtftMs: percentile(
      rows.map((r) => r.ttftMs),
      0.5,
    ),
    p90TtftMs: percentile(
      rows.map((r) => r.ttftMs),
      0.9,
    ),
    medianLatencyMs: percentile(
      rows.map((r) => r.latencyMs),
      0.5,
    ),
    meanInputTokens: mean(rows.map((r) => r.inputTokens)),
    meanOutputTokens: mean(rows.map((r) => r.outputTokens)),
    costPer1000: rows.every((r) => r.costUsd !== undefined) ? (mean(rows.map((r) => r.costUsd)) ?? 0) * 1000 : undefined,
    costSource: [...new Set(rows.map((r) => r.costSource))].join('+'),
  };
}
const summary = models.flatMap((model) =>
  modes.map((mode) => ({ model, mode, ...summarize(records.filter((r) => r.model === model && r.mode === mode)) })),
);
const languages = models.flatMap((model) =>
  modes.flatMap((mode) =>
    ['en', 'ar', 'mixed'].map((language) => ({
      model,
      mode,
      language,
      ...summarize(records.filter((r) => r.model === model && r.mode === mode && r.language === language)),
    })),
  ),
);
const cell = (n: number | undefined) => (n === undefined ? '—' : n.toFixed(3));
const allRewrites = [...rewrites, ...records.flatMap((r) => (r.rewrite ? [r.rewrite] : []))];
const rewriteSummary = [...new Set(allRewrites.map((r) => r.model))].map((model) => {
  const rows = allRewrites.filter((r) => r.model === model);
  return {
    model,
    cases: rows.length,
    topicMatch: mean(rows.map((r) => (r.topicMatch === undefined ? undefined : Number(r.topicMatch)))),
    rewrittenRate: mean(rows.map((r) => Number(r.rewritten))),
    meanInputTokens: mean(rows.map((r) => r.inputTokens)),
    meanOutputTokens: mean(rows.map((r) => r.outputTokens)),
    meanCostUsd: mean(rows.map((r) => r.costUsd)),
    medianLatencyMs: percentile(
      rows.map((r) => r.latencyMs),
      0.5,
    ),
  };
});
const measuredCosts = [...records.map((r) => r.costUsd), ...records.map((r) => r.judgeSpend?.costUsd), ...allRewrites.map((r) => r.costUsd)];
const knownSpendUsd = measuredCosts.reduce<number>((sum, cost) => sum + (cost ?? 0), 0);
function table(rows: typeof summary) {
  return [
    '| Model / mode | N / errors | Answer | Refusal | Clarify | Cite valid / hit / precision | Claims | Judge (n) | Arabic | TTFT p50 / p90 ms | Latency ms | Tokens in / out | $ / 1k | Cost |',
    '|---|---:|---:|---:|---:|---|---:|---|---:|---|---:|---|---:|---|',
    ...rows.map(
      (r) =>
        `| ${r.model} / ${r.mode} | ${r.cases} / ${r.errors} | ${cell(r.answerRate)} | ${cell(r.noAnswerAccuracy)} | ${cell(r.clarifyingAccuracy)} | ${cell(r.citationValidity)} / ${cell(r.citationHit)} / ${cell(r.citationAccuracy)} | ${cell(r.claimCoverage)} | ${cell(r.judgeHelpfulness)} (${r.judgeCount}) | ${cell(r.arabicQuality)} | ${cell(r.medianTtftMs)} / ${cell(r.p90TtftMs)} | ${cell(r.medianLatencyMs)} | ${cell(r.meanInputTokens)} / ${cell(r.meanOutputTokens)} | ${cell(r.costPer1000)} | ${r.costSource} |`,
    ),
  ].join('\n');
}
const markdown = [
  table(summary),
  `\nKnown answer + rewrite + judge spend: $${knownSpendUsd.toFixed(6)} (missing cost remains unknown).`,
  '\nRewrite models (same-model and independent calls):\n\n| Model | N | Topic match | Changed query | Tokens in / out | Mean cost $ | Median ms |\n|---|---:|---:|---:|---|---:|---:|',
  ...rewriteSummary.map(
    (r) =>
      `| ${r.model} | ${r.cases} | ${cell(r.topicMatch)} | ${cell(r.rewrittenRate)} | ${cell(r.meanInputTokens)} / ${cell(r.meanOutputTokens)} | ${r.meanCostUsd?.toFixed(6) ?? '—'} | ${cell(r.medianLatencyMs)} |`,
  ),
  ...['en', 'ar', 'mixed'].map((l) => `\nLanguage: ${l}\n\n${table(languages.filter((r) => r.language === l))}`),
  '\nRates are 0–1; — means no observations. Citation hit = at least one expected heading; precision = share of cited headings expected. Legacy fixtures without expected headings are excluded from citation accuracy. Claims use normalized phrase matches; empty claim lists are unscored. Arabic is a prose letter-share heuristic, not a fluency judgment. TTFT measures the first public streamed delta; declines have no public delta. Latency includes same-model rewriting, excludes judge. Cost per 1k covers answer calls only; rewrite and judge costs are recorded separately. Errors count against answer/refusal/clarifying/validity rates; other missing measurements remain unknown. A smoke run does not establish a winning model.',
].join('\n');
const output = resolve(here, '../../../output/search-eval', `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), evidenceHashes, models: models.map((id) => ({ id, pricing: pricing(id) })), judgeModel, condenseModels, fixtureFiles, fixtures: fixtures.map((f) => f.id), reservedUsd, knownSpendUsd, summary, languages, records, rewrites, rewriteSummary, rewriteErrors }, null, 2)}\n`,
);
await writeFile(output.replace(/\.json$/, '.md'), `${markdown}\n`);
console.log(markdown);
console.log(`Output: ${output}`);
if (records.some((r) => r.error || r.judgeError) || rewriteErrors.length) process.exitCode = 1;
