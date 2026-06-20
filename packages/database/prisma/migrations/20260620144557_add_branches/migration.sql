-- AlterTable
ALTER TABLE "page" ADD COLUMN     "branchId" TEXT;

-- CreateTable
CREATE TABLE "branch" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branch_projectId_idx" ON "branch"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "branch_projectId_name_key" ON "branch"("projectId", "name");

-- CreateIndex
CREATE INDEX "page_branchId_idx" ON "page"("branchId");

-- AddForeignKey
ALTER TABLE "branch" ADD CONSTRAINT "branch_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "page" ADD CONSTRAINT "page_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: give every existing project a default 'main' branch, then attach all
-- of that project's existing pages to it.
INSERT INTO "branch" ("id", "projectId", "name", "isDefault", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, p."id", 'main', true, now(), now()
FROM "project" p;

UPDATE "page" SET "branchId" = b."id"
FROM "branch" b
WHERE "page"."projectId" = b."projectId" AND b."isDefault" = true;
