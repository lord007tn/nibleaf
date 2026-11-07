-- CreateTable
CREATE TABLE "page_git_import_source" (
    "pageId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "languageId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "page_git_import_source_pkey" PRIMARY KEY ("pageId")
);

-- CreateIndex
CREATE UNIQUE INDEX "page_git_import_source_projectId_branchId_languageId_path_key" ON "page_git_import_source"("projectId", "branchId", "languageId", "path");

-- AddForeignKey
ALTER TABLE "page_git_import_source" ADD CONSTRAINT "page_git_import_source_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data: builds that stored the Git import identity in page settings kept it at
-- `config.gitImport.path`. Move it here. When several pages claim one path in a
-- branch/language (a duplicated page copies its config), the oldest keeps it,
-- matching what the importer chose. Idempotent: existing rows are kept.
INSERT INTO "page_git_import_source" ("pageId", "projectId", "branchId", "languageId", "path", "updatedAt")
SELECT DISTINCT ON ("projectId", "branchId", "languageId", "config" #>> '{gitImport,path}')
  "id", "projectId", "branchId", "languageId", "config" #>> '{gitImport,path}', CURRENT_TIMESTAMP
FROM "page"
WHERE "kind" = 'PAGE'
  AND jsonb_typeof("config") = 'object'
  AND jsonb_typeof("config" #> '{gitImport,path}') = 'string'
  AND length("config" #>> '{gitImport,path}') > 0
ORDER BY "projectId", "branchId", "languageId", "config" #>> '{gitImport,path}', "createdAt", "id"
ON CONFLICT DO NOTHING;

-- Strip the key from every page's settings (including duplicates that did not
-- keep the identity), so it is never published or sent back by the editor.
UPDATE "page"
SET "config" = CASE WHEN ("config" - 'gitImport') = '{}'::jsonb THEN NULL ELSE "config" - 'gitImport' END
WHERE jsonb_typeof("config") = 'object' AND "config" ? 'gitImport';
