import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenRouter } from '@openrouter/sdk';
import type { Model } from '@openrouter/sdk/models';
import { openaiCompatibleText } from '@tanstack/ai-openai/compatible';
import { type ChatHistoryMessage, streamGroundedChat } from '../src/answer-chat';
import { generateGroundedAnswer, type SearchChunk } from '../src/index';
import { OpenRouterChatProvider } from '../src/providers';

interface Fixture {
  id: string;
  language: string;
  question: string;
  sources: Array<{ title: string; path: string; heading: string; content: string }>;
  requiredClaims: string[];
  forbiddenClaims?: string[];
  expectedNoAnswer: boolean;
  history?: ChatHistoryMessage[];
  pageContext?: { title: string; path: string };
}

interface EvaluationRecord {
  mode: 'strict' | 'chat';
  droppedParagraphs: number;
  totalTokens?: number;
  model: string;
  fixture: string;
  status: 'answered' | 'no_answer';
  answer: string;
  citationIds: string[];
  expectedNoAnswer: boolean;
  citationValidity: number;
  requiredClaimCoverage: number;
  noAnswerCorrect: boolean;
  languageQuality: number;
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
}

const here = dirname(fileURLToPath(import.meta.url));
const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) throw new Error('OPENROUTER_API_KEY is required. Store it outside Git; the benchmark never prints it.');

const models = (process.env.OPENROUTER_EVAL_MODELS ?? 'openai/gpt-5.6-luna,deepseek/deepseek-v4-flash-0731,z-ai/glm-5.3')
  .split(',')
  .map((model) => model.trim())
  .filter(Boolean);

const fixtures = JSON.parse(await readFile(resolve(here, '../eval/rag-answer-fixtures.json'), 'utf8')) as Fixture[];
const openRouter = new OpenRouter({ apiKey, timeoutMs: 30_000 });
const catalog: Model[] = [];
for await (const page of await openRouter.models.list()) catalog.push(...page.result.data);

for (const model of models) {
  if (!catalog.some((candidate) => candidate.id === model)) throw new Error(`Configured evaluation model is not currently available: ${model}`);
}

const normalize = (value: string): string => value.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const chunks = (fixture: Fixture): SearchChunk[] =>
  fixture.sources.map((source, index) => ({
    id: `fixture-${fixture.id}-${index}`,
    pageId: `page-${fixture.id}-${index}`,
    ordinal: index,
    title: source.title,
    path: source.path,
    description: '',
    heading: source.heading,
    headingPath: [source.heading],
    content: source.content,
    contentHash: `fixture-${index}`,
    language: fixture.language,
    direction: fixture.language.startsWith('ar') ? 'rtl' : 'ltr',
    visible: true,
  }));

const records: EvaluationRecord[] = [];
const evalMode = process.env.EVAL_MODE ?? 'both';
if (!['strict', 'chat', 'both'].includes(evalMode)) throw new Error('EVAL_MODE must be strict, chat, or both');
const modes: Array<'strict' | 'chat'> = evalMode === 'both' ? ['strict', 'chat'] : [evalMode as 'strict' | 'chat'];
for (const model of models) {
  const provider = new OpenRouterChatProvider({
    apiKey,
    model,
    timeoutMs: 60_000,
    temperature: 0,
    title: 'Nibleaf RAG evaluation',
  });
  for (const mode of modes) {
    for (const fixture of fixtures) {
      const answer =
        mode === 'strict'
          ? await generateGroundedAnswer(provider, fixture.question, chunks(fixture), 0.85, fixture.language)
          : await streamGroundedChat({
              adapter: openaiCompatibleText(model, {
                baseURL: 'https://openrouter.ai/api/v1',
                apiKey,
                api: 'chat-completions',
                timeout: 60_000,
                maxRetries: 0,
              }),
              model,
              question: fixture.question,
              history: fixture.history ?? [],
              chunks: chunks(fixture),
              language: fixture.language,
              pageContext: fixture.pageContext,
            }).result;
      const normalized = normalize(answer.answer);
      const requiredCoverage =
        fixture.requiredClaims.length === 0
          ? 1
          : fixture.requiredClaims.filter((claim) => normalized.includes(normalize(claim))).length / fixture.requiredClaims.length;
      const forbiddenPresent = (fixture.forbiddenClaims ?? []).some((claim) => normalized.includes(normalize(claim)));
      const noAnswerCorrect = fixture.expectedNoAnswer ? answer.status === 'no_answer' : answer.status === 'answered';
      const validCitations =
        answer.status === 'no_answer' ||
        (answer.citations.length > 0 && answer.citations.every((citation) => chunks(fixture).some((_, index) => citation.id === `S${index + 1}`)));
      const arabicCharacters = (answer.answer.match(/[\u0600-\u06ff]/g) ?? []).length;
      const letters = (answer.answer.match(/[\p{L}]/gu) ?? []).length || 1;
      const languageQuality = fixture.language.startsWith('ar') ? arabicCharacters / letters : 1 - arabicCharacters / letters;
      const pricing = catalog.find((candidate) => candidate.id === model)?.pricing;
      const inputTokens = answer.usage?.inputTokens;
      const outputTokens = answer.usage?.outputTokens;
      const calculatedCostUsd =
        inputTokens !== undefined && outputTokens !== undefined && pricing
          ? inputTokens * Number(pricing.prompt) + outputTokens * Number(pricing.completion)
          : undefined;
      records.push({
        mode,
        droppedParagraphs: 'droppedParagraphs' in answer ? answer.droppedParagraphs : 0,
        totalTokens: answer.usage?.totalTokens,
        model,
        fixture: fixture.id,
        status: answer.status,
        answer: answer.answer,
        citationIds: answer.citations.map((citation) => citation.id),
        expectedNoAnswer: fixture.expectedNoAnswer,
        citationValidity: validCitations && !forbiddenPresent ? 1 : 0,
        requiredClaimCoverage: requiredCoverage,
        noAnswerCorrect,
        languageQuality,
        latencyMs: answer.latencyMs,
        inputTokens,
        outputTokens,
        costUsd: answer.usage?.costUsd ?? calculatedCostUsd,
      });
    }
  }
}

const summary = models.flatMap((model) =>
  modes.map((mode) => {
    const rows = records.filter((record) => record.model === model && record.mode === mode);
    const mean = (select: (row: EvaluationRecord) => number | undefined) =>
      rows.reduce((sum, row) => sum + (select(row) ?? 0), 0) / Math.max(1, rows.length);
    const sumWhenKnown = (select: (row: EvaluationRecord) => number | undefined) => {
      const values = rows.map(select);
      return values.some((value) => value === undefined) ? undefined : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    };
    return {
      model,
      mode,
      answerRate:
        rows.filter((row) => !row.expectedNoAnswer && row.status === 'answered').length /
        Math.max(1, rows.filter((row) => !row.expectedNoAnswer).length),
      droppedParagraphs: rows.reduce((sum, row) => sum + row.droppedParagraphs, 0),
      totalTokens: sumWhenKnown((row) => row.totalTokens),
      cases: rows.length,
      citationValidity: mean((row) => row.citationValidity),
      requiredClaimCoverage: mean((row) => row.requiredClaimCoverage),
      noAnswerAccuracy:
        rows.filter((row) => row.expectedNoAnswer && row.noAnswerCorrect).length / Math.max(1, rows.filter((row) => row.expectedNoAnswer).length),
      languageQuality: mean((row) => row.languageQuality),
      latencyMs: mean((row) => row.latencyMs),
      inputTokens: sumWhenKnown((row) => row.inputTokens),
      outputTokens: sumWhenKnown((row) => row.outputTokens),
      costUsd: sumWhenKnown((row) => row.costUsd),
    };
  }),
);

const output = resolve(here, '../../../output/search-eval', `${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
await mkdir(dirname(output), { recursive: true });
await writeFile(
  output,
  `${JSON.stringify({ generatedAt: new Date().toISOString(), models, fixtures: fixtures.map((fixture) => fixture.id), summary, records }, null, 2)}\n`,
);
console.log(JSON.stringify({ output, summary }, null, 2));
