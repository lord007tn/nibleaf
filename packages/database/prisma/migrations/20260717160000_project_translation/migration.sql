-- Store localized project identity in an explicit translation table with a
-- proper Language reference. Existing JSON values are migrated in-place.
CREATE TABLE "project_translation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "languageId" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_translation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_translation_projectId_languageId_key"
ON "project_translation"("projectId", "languageId");

CREATE INDEX "project_translation_languageId_idx"
ON "project_translation"("languageId");

ALTER TABLE "project_translation"
ADD CONSTRAINT "project_translation_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_translation"
ADD CONSTRAINT "project_translation_languageId_fkey"
FOREIGN KEY ("languageId") REFERENCES "language"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "project_translation" ("id", "projectId", "languageId", "name", "description", "updatedAt")
SELECT
    'pt_' || md5(l."projectId" || ':' || l."id"),
    l."projectId",
    l."id",
    NULLIF(l."config"->>'name', ''),
    NULLIF(l."config"->>'description', ''),
    CURRENT_TIMESTAMP
FROM "language" l
WHERE (l."config" ? 'name' OR l."config" ? 'description')
  AND (NULLIF(l."config"->>'name', '') IS NOT NULL OR NULLIF(l."config"->>'description', '') IS NOT NULL);

UPDATE "language"
SET "config" = NULLIF("config" - 'name' - 'description', '{}'::jsonb)
WHERE "config" ? 'name' OR "config" ? 'description';
