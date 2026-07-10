BEGIN;

-- Fold the former top-level appearance columns into the canonical Project.config
-- document. Existing config values win over the retired columns.
WITH normalized AS (
  SELECT
    "id",
    "color",
    "logoUrl",
    "faviconUrl",
    CASE WHEN jsonb_typeof("config") = 'object' THEN "config" ELSE '{}'::jsonb END AS config_object,
    CASE WHEN jsonb_typeof("theme") = 'object' THEN "theme" ELSE '{}'::jsonb END AS theme_object
  FROM "project"
), merged AS (
  SELECT
    "id",
    jsonb_set(
      jsonb_set(
        jsonb_set(
          config_object,
          '{styling}',
          jsonb_strip_nulls(
            jsonb_build_object(
              'primaryColor', COALESCE(theme_object->>'primaryColor', theme_object->>'accentColor', "color")
            )
          ) || CASE
            WHEN jsonb_typeof(config_object->'styling') = 'object' THEN config_object->'styling'
            ELSE '{}'::jsonb
          END,
          true
        ),
        '{branding}',
        jsonb_strip_nulls(
          jsonb_build_object(
            'logoLight', "logoUrl",
            'favicon', "faviconUrl"
          )
        ) || CASE
          WHEN jsonb_typeof(config_object->'branding') = 'object' THEN config_object->'branding'
          ELSE '{}'::jsonb
        END,
        true
      ),
      '{typography}',
      CASE
        WHEN NULLIF(theme_object->>'font', '') IS NULL THEN CASE
          WHEN jsonb_typeof(config_object->'typography') = 'object' THEN config_object->'typography'
          ELSE '{}'::jsonb
        END
        ELSE jsonb_build_object(
          'headingFont', theme_object->>'font',
          'bodyFont', theme_object->>'font'
        ) || CASE
          WHEN jsonb_typeof(config_object->'typography') = 'object' THEN config_object->'typography'
          ELSE '{}'::jsonb
        END
      END,
      true
    ) AS config_object
  FROM normalized
)
UPDATE "project" p
SET "config" = merged.config_object
FROM merged
WHERE p."id" = merged."id";

ALTER TABLE "project"
  DROP COLUMN "color",
  DROP COLUMN "logoUrl",
  DROP COLUMN "faviconUrl",
  DROP COLUMN "theme";

-- Every project owns exactly one default language and one default branch. Older
-- projects could have neither (or multiple defaults), so normalize the invariant
-- before making Page's foreign keys mandatory.
INSERT INTO "language" (
  "id", "projectId", "code", "label", "direction", "isDefault", "position", "createdAt", "updatedAt"
)
SELECT 'lang_' || p."id", p."id", 'en', 'English', 'LTR', true, 0, now(), now()
FROM "project" p
WHERE NOT EXISTS (SELECT 1 FROM "language" l WHERE l."projectId" = p."id");

INSERT INTO "branch" (
  "id", "projectId", "name", "isDefault", "createdAt", "updatedAt"
)
SELECT 'branch_' || p."id", p."id", 'main', true, now(), now()
FROM "project" p
WHERE NOT EXISTS (SELECT 1 FROM "branch" b WHERE b."projectId" = p."id");

WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "projectId"
      ORDER BY "isDefault" DESC, "position" ASC, "createdAt" ASC, "id" ASC
    ) AS default_rank
  FROM "language"
)
UPDATE "language" l
SET "isDefault" = ranked.default_rank = 1
FROM ranked
WHERE l."id" = ranked."id"
  AND l."isDefault" IS DISTINCT FROM (ranked.default_rank = 1);

WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "projectId"
      ORDER BY "isDefault" DESC, "createdAt" ASC, "id" ASC
    ) AS default_rank
  FROM "branch"
)
UPDATE "branch" b
SET "isDefault" = ranked.default_rank = 1
FROM ranked
WHERE b."id" = ranked."id"
  AND b."isDefault" IS DISTINCT FROM (ranked.default_rank = 1);

CREATE UNIQUE INDEX "language_projectId_default_key"
ON "language"("projectId")
WHERE "isDefault" = true;

CREATE UNIQUE INDEX "branch_projectId_default_key"
ON "branch"("projectId")
WHERE "isDefault" = true;

UPDATE "page" p
SET "languageId" = l."id"
FROM "language" l
WHERE p."languageId" IS NULL
  AND l."projectId" = p."projectId"
  AND l."isDefault" = true;

UPDATE "page" p
SET "branchId" = b."id"
FROM "branch" b
WHERE p."branchId" IS NULL
  AND b."projectId" = p."projectId"
  AND b."isDefault" = true;

ALTER TABLE "page"
  ALTER COLUMN "languageId" SET NOT NULL,
  ALTER COLUMN "branchId" SET NOT NULL;

COMMIT;
