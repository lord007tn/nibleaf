-- Per-page and per-language SEO + behaviour overrides (nullable JSON, additive).
ALTER TABLE "page" ADD COLUMN "config" JSONB;
ALTER TABLE "language" ADD COLUMN "config" JSONB;
