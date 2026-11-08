/**
 * Dense-retrieval benchmark of embedding models on Nibleaf's own docs, with the
 * product's chunker, embedding text and OpenRouter request shape.
 *
 *   OPENROUTER_API_KEY=… EVAL_EMBED_OUTPUT_DIR=/private/results EVAL_EMBED_CACHE_DIR=/private/cache \
 *     pnpm --filter @nibleaf/search eval:embeddings
 *
 * Queries are the docs fixtures' questions; a chunk is relevant when it comes from
 * a fixture source page under an expected heading. Each language searches its own
 * pages, as a site search does (mixed questions search Arabic pages). Corpus
 * vectors are cached per model and dimension, so a rerun does not pay twice.
 */
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chunkSearchDocument, type SearchChunk, searchEmbeddingText } from '../src/hybrid';
import { OpenRouterEmbeddingProvider } from '../src/providers';
import type { Fixture } from './build-docs-fixtures';

const here = dirname(fileURLToPath(import.meta.url));
const apiKey = process.env.OPENROUTER_API_KEY;
const outputDir = process.env.EVAL_EMBED_OUTPUT_DIR;
const cacheDir = process.env.EVAL_EMBED_CACHE_DIR;
if (!apiKey || !outputDir || !cacheDir) throw new Error('OPENROUTER_API_KEY, EVAL_EMBED_OUTPUT_DIR and EVAL_EMBED_CACHE_DIR are required.');
const models = (
  process.env.EVAL_EMBED_MODELS ??
  'openai/text-embedding-3-small,openai/text-embedding-3-large,google/gemini-embedding-2,cohere/embed-5-pro,qwen/qwen3-embedding-8b'
)
  .split(',')
  .map((id) => id.trim())
  .filter(Boolean);
const PRODUCT_DIMENSIONS = 1536;
/** The worker embeds sequentially in batches of 64 (apps/worker/src/processors/search.ts). */
const WORKER_BATCH = 64;
const budget = Number(process.env.EVAL_MAX_COST_USD ?? 2);

const catalog = (await (await fetch('https://openrouter.ai/api/v1/embeddings/models')).json()) as {
  data: { id: string; pricing: { prompt: string } }[];
};
const price = (id: string) => {
  const found = catalog.data.find((model) => model.id === id);
  if (!found) throw new Error(`Embedding model absent from the live catalog: ${id}`);
  return Number(found.pricing.prompt);
};
for (const id of models) price(id);

// Corpus: every docs page, chunked as the worker chunks a published page.
const docsRoot = resolve(here, '../../../docs');
const files = (await readdir(docsRoot, { recursive: true })).filter((file) => file.endsWith('.mdx'));
const corpus: SearchChunk[] = [];
for (const file of files.sort()) {
  const text = await readFile(resolve(docsRoot, file), 'utf8');
  const [, front = '', body = text] = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text) ?? [];
  const field = (name: string) => new RegExp(`^${name}:\\s*['"]?(.*?)['"]?\\s*$`, 'm').exec(front)?.[1] ?? '';
  const path = relative(docsRoot, resolve(docsRoot, file))
    .replace(/\\/g, '/')
    .replace(/\.mdx$/, '');
  corpus.push(
    ...chunkSearchDocument(
      { projectId: 'docs', deploymentId: 'eval', versionSlug: 'main' },
      {
        id: path,
        title: field('title') || path,
        path,
        description: field('description'),
        headings: [],
        content: body,
        language: field('lang') || (path.startsWith('ar/') ? 'ar' : 'en'),
        visible: true,
      },
    ),
  );
}
const corpusTexts = corpus.map(searchEmbeddingText);
const corpusBytes = corpusTexts.reduce((sum, text) => sum + Buffer.byteLength(text, 'utf8'), 0);

const fixtures = (JSON.parse(await readFile(resolve(here, '../eval/nibleaf-docs-fixtures.json'), 'utf8')) as Fixture[]).filter(
  (f) => f.expectedSourceHeadings?.length,
);
// EVAL_LIMIT keeps the first queries only, for a smoke run; corpus vectors stay cached for the full run.
const queries = fixtures.slice(0, Number(process.env.EVAL_LIMIT ?? fixtures.length)).map((f) => {
  const expected = new Set(f.expectedSourceHeadings);
  const pages = new Set(f.sources.filter((s) => expected.has(s.heading)).map((s) => s.path));
  const relevant = (chunk: SearchChunk) => pages.has(chunk.path) && chunk.headingPath.some((heading) => expected.has(heading));
  const pool = corpus.flatMap((chunk, index) => ((f.language === 'en' ? chunk.language === 'en' : chunk.language === 'ar') ? [index] : []));
  if (!pool.some((index) => relevant(corpus[index] as SearchChunk))) throw new Error(`No relevant chunk for fixture ${f.id}`);
  return { id: f.id, language: f.language, question: f.question, pool, relevant };
});

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
let reservedUsd = 0;
const reserve = (model: string, bytes: number) => {
  // One token per byte is the most a byte-level tokenizer can produce.
  reservedUsd += bytes * price(model);
  if (reservedUsd > budget) throw new Error('Embedding spend reservation exceeds EVAL_MAX_COST_USD; no request dispatched.');
};

/** Native size from one tiny request without `dimensions`; not the product shape, only a probe. */
const nativeDimensions = async (model: string) => {
  reserve(model, 64);
  const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: ['dimension probe'], encoding_format: 'float' }),
  });
  if (!response.ok) throw new Error(`Dimension probe failed for ${model}: HTTP ${response.status}`);
  const body = (await response.json()) as { data?: { embedding?: number[] }[] };
  const size = body.data?.[0]?.embedding?.length;
  if (!size) throw new Error(`Dimension probe returned no vector for ${model}`);
  return size;
};

interface CorpusCache {
  model: string;
  dimensions: number;
  reindexMs: number;
  promptTokens?: number;
  vectors: Record<string, number[]>;
}
const embedCorpus = async (model: string, dimensions: number): Promise<CorpusCache> => {
  const file = resolve(cacheDir, `${model.replace(/[^a-z0-9.-]+/gi, '_')}-${dimensions}.json`);
  const cached = await readFile(file, 'utf8')
    .then((text) => JSON.parse(text) as CorpusCache)
    .catch(() => undefined);
  if (cached && corpusTexts.every((text) => cached.vectors[hash(text)])) return cached;
  reserve(model, corpusBytes);
  const provider = new OpenRouterEmbeddingProvider({ apiKey, model, dimensions, timeoutMs: 120_000 });
  const vectors: Record<string, number[]> = {};
  let promptTokens: number | undefined = 0;
  const started = performance.now();
  for (let offset = 0; offset < corpusTexts.length; offset += WORKER_BATCH) {
    const batch = corpusTexts.slice(offset, offset + WORKER_BATCH);
    const result = await provider.embed(batch);
    batch.forEach((text, index) => {
      vectors[hash(text)] = result.vectors[index] as number[];
    });
    promptTokens = result.usage && promptTokens !== undefined ? promptTokens + result.usage.promptTokens : undefined;
  }
  const value: CorpusCache = { model, dimensions, reindexMs: Math.round(performance.now() - started), promptTokens, vectors };
  await mkdir(cacheDir, { recursive: true });
  await writeFile(file, JSON.stringify(value));
  return value;
};

const cosine = (left: number[], right: number[]) => {
  let dot = 0;
  let a = 0;
  let b = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += (left[index] ?? 0) * (right[index] ?? 0);
    a += (left[index] ?? 0) ** 2;
    b += (right[index] ?? 0) ** 2;
  }
  return dot / (Math.sqrt(a * b) || 1);
};

interface Row {
  label: string;
  model: string;
  dimensions: number;
  native: boolean;
  nativeDimensions: number;
  error?: string;
  pricePerMillion?: number;
  corpusChunks?: number;
  corpusTokens?: number;
  corpusCostUsd?: number;
  reindexMs?: number;
  byLanguage?: Record<string, { n: number; recallAt5: number; mrrAt10: number }>;
  queries?: unknown[];
}
const rows: Row[] = [];
for (const model of models) {
  const native = await nativeDimensions(model);
  for (const dimensions of [...new Set([native, PRODUCT_DIMENSIONS])]) {
    const label = `${model} @ ${dimensions}${dimensions === native ? ' (native)' : ''}`;
    try {
      const index = await embedCorpus(model, dimensions);
      reserve(
        model,
        queries.reduce((sum, q) => sum + Buffer.byteLength(q.question, 'utf8'), 0),
      );
      // The product embeds a query exactly like a document: no query/document task type.
      const queryVectors = (
        await new OpenRouterEmbeddingProvider({ apiKey, model, dimensions, timeoutMs: 60_000 }).embed(queries.map((q) => q.question))
      ).vectors;
      const scored = queries.map((query, queryIndex) => {
        const vector = queryVectors[queryIndex] as number[];
        const ranked = query.pool
          .map((chunkIndex) => ({
            chunk: corpus[chunkIndex] as SearchChunk,
            score: cosine(vector, index.vectors[hash(corpusTexts[chunkIndex] as string)] as number[]),
          }))
          .sort((left, right) => right.score - left.score);
        const firstRelevant = ranked.findIndex(({ chunk }) => query.relevant(chunk));
        return {
          id: query.id,
          language: query.language,
          recallAt5: Number(firstRelevant >= 0 && firstRelevant < 5),
          mrrAt10: firstRelevant >= 0 && firstRelevant < 10 ? 1 / (firstRelevant + 1) : 0,
          firstRelevantRank: firstRelevant + 1,
        };
      });
      const byLanguage = Object.fromEntries(
        ['en', 'ar', 'mixed'].map((language) => {
          const subset = scored.filter((s) => s.language === language);
          const mean = (key: 'recallAt5' | 'mrrAt10') => subset.reduce((sum, s) => sum + s[key], 0) / (subset.length || 1);
          return [language, { n: subset.length, recallAt5: mean('recallAt5'), mrrAt10: mean('mrrAt10') }];
        }),
      );
      const tokens = index.promptTokens;
      rows.push({
        label,
        model,
        dimensions,
        native: dimensions === native,
        nativeDimensions: native,
        pricePerMillion: price(model) * 1e6,
        corpusChunks: corpus.length,
        corpusTokens: tokens,
        corpusCostUsd: tokens === undefined ? undefined : tokens * price(model),
        reindexMs: index.reindexMs,
        byLanguage,
        queries: scored,
      });
      console.log(`${label}: done`);
    } catch (error) {
      rows.push({
        label,
        model,
        dimensions,
        native: dimensions === native,
        nativeDimensions: native,
        error: error instanceof Error ? error.message : 'failed',
      });
      console.log(`${label}: failed (${error instanceof Error ? error.message : 'unknown'})`);
    }
  }
}

const cell = (value: number | undefined, digits = 3) => (value === undefined ? '—' : value.toFixed(digits));
const markdown = [
  `Corpus: ${files.length} pages, ${corpus.length} chunks, ${corpusBytes} UTF-8 bytes. Queries: ${['en', 'ar', 'mixed'].map((l) => `${l} ${queries.filter((q) => q.language === l).length}`).join(', ')}.`,
  '',
  '| Model @ dimensions | EN R@5 / MRR@10 | AR R@5 / MRR@10 | Mixed R@5 / MRR@10 | $ / 1M | Corpus tokens | Corpus $ | Reindex s |',
  '|---|---|---|---|---:|---:|---:|---:|',
  ...rows.map((row) =>
    row.error
      ? `| ${row.label} | failed: ${row.error} | | | | | | |`
      : `| ${row.label} | ${['en', 'ar', 'mixed'].map((l) => `${cell(row.byLanguage?.[l]?.recallAt5)} / ${cell(row.byLanguage?.[l]?.mrrAt10)}`).join(' | ')} | ${cell(row.pricePerMillion, 2)} | ${row.corpusTokens ?? '—'} | ${cell(row.corpusCostUsd, 4)} | ${cell(row.reindexMs === undefined ? undefined : row.reindexMs / 1000, 1)} |`,
  ),
  '',
  'Dense cosine retrieval only (the product fuses this with BM25). Reindex = wall-clock to embed the whole corpus in sequential batches of 64, as the worker does. Small samples: one query moves a language mean by 0.1.',
].join('\n');
await mkdir(outputDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
await writeFile(
  resolve(outputDir, `embeddings-${stamp}.json`),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), reservedUsd, rows }, null, 2)}\n`,
);
await writeFile(resolve(outputDir, `embeddings-${stamp}.md`), `${markdown}\n`);
console.log(markdown);
