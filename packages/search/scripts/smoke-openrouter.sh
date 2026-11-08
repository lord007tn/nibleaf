#!/usr/bin/env bash
# Usage: bash packages/search/scripts/smoke-openrouter.sh /path/to/capped-key
set -euo pipefail
OPENROUTER_API_KEY="$(cat "$1")" EVAL_MODELS=openai/gpt-6-luna,openai/gpt-6.1-terra EVAL_FIXTURES=docs EVAL_MODE=chat EVAL_LIMIT=4 EVAL_JUDGE_MODEL=openai/gpt-6.1-sol EVAL_CONCURRENCY=2 EVAL_MAX_COST_USD=0.5 pnpm --filter @nibleaf/search eval:rag
