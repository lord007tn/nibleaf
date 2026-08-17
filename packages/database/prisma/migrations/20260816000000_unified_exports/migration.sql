CREATE TYPE "ExportFormat" AS ENUM ('MARKDOWN', 'PDF', 'STATIC_HTML');
CREATE TYPE "ExportJobStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "ExportTrigger" AS ENUM ('MANUAL', 'SCHEDULED');
CREATE TYPE "ExportCadence" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

CREATE TABLE "export_snapshot" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "deploymentId" TEXT NOT NULL,
  "deploymentVersion" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "assets" JSONB NOT NULL,
  "pagesCount" INTEGER NOT NULL,
  "contentBytes" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "export_snapshot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "export_job" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "snapshotId" TEXT NOT NULL,
  "scheduleId" TEXT,
  "formats" "ExportFormat"[] NOT NULL,
  "status" "ExportJobStatus" NOT NULL DEFAULT 'PENDING',
  "trigger" "ExportTrigger" NOT NULL DEFAULT 'MANUAL',
  "idempotencyKey" TEXT,
  "createdById" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "error" TEXT,
  "cancelRequestedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "export_job_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "export_artifact" (
  "id" TEXT NOT NULL,
  "jobId" TEXT NOT NULL,
  "format" "ExportFormat" NOT NULL,
  "storageKey" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "checksum" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "export_artifact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "export_schedule" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "formats" "ExportFormat"[] NOT NULL,
  "cadence" "ExportCadence" NOT NULL,
  "timezone" TEXT NOT NULL,
  "hour" INTEGER NOT NULL,
  "minute" INTEGER NOT NULL,
  "weekday" INTEGER,
  "monthday" INTEGER,
  "retentionCount" INTEGER NOT NULL DEFAULT 12,
  "retentionDays" INTEGER NOT NULL DEFAULT 90,
  "destination" TEXT NOT NULL DEFAULT 'STORAGE',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "nextRunAt" TIMESTAMP(3),
  "lastRunAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "export_schedule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "export_job_idempotencyKey_key" ON "export_job"("idempotencyKey");
CREATE INDEX "export_snapshot_projectId_createdAt_idx" ON "export_snapshot"("projectId", "createdAt");
CREATE INDEX "export_job_projectId_createdAt_idx" ON "export_job"("projectId", "createdAt");
CREATE INDEX "export_job_scheduleId_createdAt_idx" ON "export_job"("scheduleId", "createdAt");
CREATE INDEX "export_job_status_createdAt_idx" ON "export_job"("status", "createdAt");
CREATE UNIQUE INDEX "export_artifact_storageKey_key" ON "export_artifact"("storageKey");
CREATE UNIQUE INDEX "export_artifact_jobId_format_key" ON "export_artifact"("jobId", "format");
CREATE INDEX "export_schedule_projectId_createdAt_idx" ON "export_schedule"("projectId", "createdAt");
CREATE INDEX "export_schedule_enabled_nextRunAt_idx" ON "export_schedule"("enabled", "nextRunAt");

ALTER TABLE "export_snapshot" ADD CONSTRAINT "export_snapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_snapshot" ADD CONSTRAINT "export_snapshot_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "deployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "export_job" ADD CONSTRAINT "export_job_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_job" ADD CONSTRAINT "export_job_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "export_snapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "export_job" ADD CONSTRAINT "export_job_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "export_schedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "export_job" ADD CONSTRAINT "export_job_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "export_artifact" ADD CONSTRAINT "export_artifact_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "export_job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_schedule" ADD CONSTRAINT "export_schedule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "export_schedule" ADD CONSTRAINT "export_schedule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
