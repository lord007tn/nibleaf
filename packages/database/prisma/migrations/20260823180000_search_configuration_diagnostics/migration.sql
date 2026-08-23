-- Durable, privacy-minimized hybrid-search run state. This is additive: older
-- application revisions ignore the table and continue serving legacy/shadow
-- search, so application rollback does not require an immediate schema rollback.
CREATE TYPE "SearchIndexRunStatus" AS ENUM ('PENDING', 'RUNNING', 'READY', 'FAILED', 'DISABLED');

CREATE TABLE "search_index_run" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "deploymentId" TEXT,
    "status" "SearchIndexRunStatus" NOT NULL DEFAULT 'PENDING',
    "jobId" TEXT,
    "claimToken" TEXT,
    "claimExpiresAt" TIMESTAMP(3),
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "logicalIndexId" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "revisionId" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "vectorSize" INTEGER NOT NULL,
    "expectedChunks" INTEGER NOT NULL DEFAULT 0,
    "expectedPages" INTEGER NOT NULL DEFAULT 0,
    "indexedChunks" INTEGER NOT NULL DEFAULT 0,
    "indexedPages" INTEGER NOT NULL DEFAULT 0,
    "embeddedChunks" INTEGER NOT NULL DEFAULT 0,
    "reusedChunks" INTEGER NOT NULL DEFAULT 0,
    "unchangedChunks" INTEGER NOT NULL DEFAULT 0,
    "metadataUpdatedChunks" INTEGER NOT NULL DEFAULT 0,
    "deletedChunks" INTEGER NOT NULL DEFAULT 0,
    "staleChunks" INTEGER NOT NULL DEFAULT 0,
    "failedChunks" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "issueSample" JSONB,
    "requestedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "search_index_run_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "search_index_run_projectId_createdAt_idx" ON "search_index_run"("projectId", "createdAt");
CREATE INDEX "search_index_run_deploymentId_createdAt_idx" ON "search_index_run"("deploymentId", "createdAt");
CREATE UNIQUE INDEX "search_index_run_jobId_key" ON "search_index_run"("jobId");

-- At most one active run can exist for a tenant. The partial unique index is
-- the authoritative concurrency guard; application checks only improve UX.
CREATE UNIQUE INDEX "search_index_run_one_active_per_project"
ON "search_index_run"("projectId")
WHERE "status" IN ('PENDING', 'RUNNING');

ALTER TABLE "search_index_run"
ADD CONSTRAINT "search_index_run_projectId_fkey"
FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "search_index_run"
ADD CONSTRAINT "search_index_run_deploymentId_fkey"
FOREIGN KEY ("deploymentId") REFERENCES "deployment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
