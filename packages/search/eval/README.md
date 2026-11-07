# Docs answer-model benchmark

`pnpm --filter @nibleaf/search eval:rag` measures how well answer models write
grounded chat answers from Nibleaf's own documentation. It uses the production
prompts, history bounding, follow-up rewriting, suggestions and citation
validation from `src/answer-chat.ts`, so a change there is measured as shipped.

It evaluates answer generation against supplied passages, not retrieval quality.

## Fixtures

`nibleaf-docs-fixtures.json` holds 36 cases built from real sections of `docs/`:
12 English, 12 Arabic and 12 mixed Arabic/English questions, including 6
follow-ups with history, 6 out-of-scope questions that must be refused, and 3
vague questions that should get one clarifying question. Each case supplies the
relevant section plus distractor sections, and names the headings a good answer
cites. Regenerate them after editing the docs they quote:

```bash
pnpm --filter @nibleaf/search exec tsx scripts/build-docs-fixtures.ts
pnpm exec biome format --write packages/search/eval/nibleaf-docs-fixtures.json
```

`scripts/docs-fixtures.test.ts` fails if a quoted section no longer matches the
docs. The older hand-written fixtures in `scripts/` remain loadable.

## Run it

Use a provider key with a spending cap; never commit or print it.

```bash
OPENROUTER_API_KEY=… \
EVAL_MODELS=openai/gpt-6-luna,openai/gpt-6.1-terra \
EVAL_FIXTURES=docs EVAL_MODE=chat EVAL_JUDGE_MODEL=openai/gpt-6.1-terra \
EVAL_MAX_COST_USD=3 pnpm --filter @nibleaf/search eval:rag
```

`EVAL_CATALOG_ONLY=1` lists the live catalog matches and prices without a key.
Model IDs are resolved against the live OpenRouter catalog on every run; an ID
that does not exist fails rather than being guessed.

| Variable | Meaning |
| --- | --- |
| `EVAL_MODELS` | Comma-separated exact model IDs. Without it, every live Luna and Terra match is used. |
| `EVAL_FIXTURES` | `docs`, `legacy` or `all` (default). |
| `EVAL_MODE` | `chat` (the assistant's policy), `strict` (one-shot answers) or `both` (default). |
| `EVAL_LIMIT` | Cases per model and mode, for smoke runs. |
| `EVAL_JUDGE_MODEL` | Model that scores answers against [`judge-rubric.md`](./judge-rubric.md). |
| `EVAL_CONDENSE_MODELS` | Extra models to compare for follow-up rewriting only. |
| `EVAL_CONCURRENCY` | Parallel requests (default 2). |
| `EVAL_MAX_COST_USD` | Conservative spending ceiling, reserved from catalog prices before each call. |

`scripts/smoke-openrouter.sh <key-file>` runs four cases on two models.

Receipts (JSON and Markdown, with hashes of the prompts, rubric and fixtures) go
to the gitignored `output/search-eval/`. Provider or judge failures exit with
code 1 after saving partial results.

## What is measured

- **Answer / refusal / clarify:** answerable cases answered, out-of-scope cases
  refused, vague cases answered with one clarifying question.
- **Citations:** share of answers whose markers are all valid, and how often
  they cite the expected section (precision).
- **Claims:** required facts present (normalized substring check).
- **Judge:** 1–5 scores for correctness, helpfulness, formatting and language
  quality from the rubric. The judge sees only the supplied excerpts.
- **Arabic:** Arabic-letter share of Arabic answers and whether mixed questions
  get Arabic prose with product names kept.
- **Speed and cost:** time to first token and turn latency (median and p90),
  tokens in and out, and answer cost per 1,000 answers from provider-reported
  cost. Rewrite and judge costs are reported separately.

A heuristic or LLM judge is a signal, not a verdict: spot-check answers in the
Markdown receipt before changing a default.
