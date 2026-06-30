-- Project slugs back free wildcard subdomains (<slug>.<SITE_BASE_DOMAIN>), so
-- they must be globally unique and valid DNS labels. Existing duplicates or
-- long legacy slugs are normalized before adding the unique index.

WITH normalized AS (
  SELECT
    id,
    COALESCE(NULLIF(trim(both '-' from substring(regexp_replace(lower(slug), '[^a-z0-9]+', '-', 'g') from 1 for 63)), ''), 'docs') AS base_slug,
    row_number() OVER (
      PARTITION BY COALESCE(NULLIF(trim(both '-' from substring(regexp_replace(lower(slug), '[^a-z0-9]+', '-', 'g') from 1 for 63)), ''), 'docs')
      ORDER BY "createdAt", id
    ) AS duplicate_number
  FROM "project"
),
deduped AS (
  SELECT
    id,
    CASE
      WHEN duplicate_number = 1 THEN base_slug
      ELSE left(base_slug, 63 - length('-' || duplicate_number::text)) || '-' || duplicate_number::text
    END AS next_slug
  FROM normalized
)
UPDATE "project"
SET slug = deduped.next_slug
FROM deduped
WHERE "project".id = deduped.id
  AND "project".slug <> deduped.next_slug;

CREATE UNIQUE INDEX "project_slug_key" ON "project"("slug");
