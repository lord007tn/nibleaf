BEGIN;

-- Baseline DDL generated with prisma migrate diff; backfill/compatibility added below.
-- DropForeignKey
ALTER TABLE "usage_storage_marker" DROP CONSTRAINT "usage_storage_marker_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "usage_ingest_checkpoint" DROP CONSTRAINT "usage_ingest_checkpoint_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "project" DROP CONSTRAINT "project_organizationId_fkey";

-- DropIndex
DROP INDEX "project_organizationId_key";

-- AlterTable
ALTER TABLE "usage_provider_checkpoint" ADD COLUMN     "billingOrganizationId" TEXT,
ADD COLUMN     "projectId" TEXT;

-- AlterTable
ALTER TABLE "usage_storage_marker" ADD COLUMN     "partitionId" TEXT,
ADD COLUMN     "projectId" TEXT;

-- AlterTable
ALTER TABLE "usage_ingest_checkpoint" ADD COLUMN     "partitionId" TEXT;

-- AlterTable
ALTER TABLE "project" ADD COLUMN     "dataTenantId" TEXT;

-- CreateTable
CREATE TABLE "project_git_settings" (
    "projectId" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "project_git_settings_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "project_git_webhook_secret" (
    "projectId" TEXT NOT NULL,
    "secret" TEXT NOT NULL,

    CONSTRAINT "project_git_webhook_secret_pkey" PRIMARY KEY ("projectId")
);

-- CreateTable
CREATE TABLE "project_legacy_settings" (
    "projectId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "project_legacy_settings_pkey" PRIMARY KEY ("projectId")
);


-- Keep the legacy organizationId values as historical partition mirrors. Their
-- org FKs are removed above: deleting a moved-from org must neither erase nor
-- block the website's receipts. Ownership/cascades now follow Project only.
UPDATE "project" SET "dataTenantId" = "organizationId";
UPDATE "usage_storage_marker" m SET "partitionId" = p."dataTenantId", "projectId" = p.id
FROM "project" p WHERE p."organizationId" = m."organizationId";
UPDATE "usage_ingest_checkpoint" c SET "partitionId" = p."dataTenantId"
FROM "project" p WHERE p.id = c."projectId";
ALTER TABLE "project" ALTER COLUMN "dataTenantId" SET NOT NULL;
ALTER TABLE "usage_storage_marker" ALTER COLUMN "partitionId" SET NOT NULL, ALTER COLUMN "projectId" SET NOT NULL;
ALTER TABLE "usage_ingest_checkpoint" ALTER COLUMN "partitionId" SET NOT NULL;

-- Invalid JSON aborts the migration rather than silently discarding settings.
-- Preserve every legacy column; only COPY settings and exact secret strings.
INSERT INTO "project_git_settings" ("projectId", settings)
SELECT p.id, CASE WHEN jsonb_typeof(o.metadata::jsonb->'git') = 'object'
  THEN (o.metadata::jsonb->'git') - 'webhookSecret' ELSE '{}'::jsonb END
FROM project p JOIN organization o ON o.id = p."organizationId"
WHERE (SELECT count(*) FROM project sibling WHERE sibling."organizationId" = o.id) = 1;
INSERT INTO "project_git_webhook_secret" ("projectId", secret)
SELECT p.id, COALESCE(s.secret, o.metadata::jsonb->'git'->>'webhookSecret')
FROM project p JOIN organization o ON o.id = p."organizationId"
LEFT JOIN organization_git_webhook_secret s ON s."organizationId" = o.id
WHERE (SELECT count(*) FROM project sibling WHERE sibling."organizationId" = o.id) = 1
  AND COALESCE(s.secret, o.metadata::jsonb->'git'->>'webhookSecret') IS NOT NULL;
INSERT INTO "project_legacy_settings" ("projectId", metadata)
SELECT p.id, COALESCE(o.metadata::jsonb, '{}'::jsonb) - ARRAY['plan','notifications','entitlements','git']
FROM project p JOIN organization o ON o.id = p."organizationId"
WHERE (SELECT count(*) FROM project sibling WHERE sibling."organizationId" = o.id) = 1;

-- Old images omit the new column on INSERT. New Prisma writers supply a fresh
-- cuid via @default(cuid()); old writers retain their original partition key.
CREATE FUNCTION project_data_partition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW."dataTenantId" := COALESCE(NEW."dataTenantId", NEW."organizationId");
  ELSIF NEW."dataTenantId" IS DISTINCT FROM OLD."dataTenantId" THEN
    RAISE EXCEPTION 'Project.dataTenantId is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER project_data_partition BEFORE INSERT OR UPDATE ON project
FOR EACH ROW EXECUTE FUNCTION project_data_partition();

-- Expand-only compatibility for legacy ingestion INSERTs that omit new fields.
CREATE FUNCTION usage_partition_defaults() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'usage_storage_marker' AND NEW."projectId" IS NULL THEN
    SELECT id INTO STRICT NEW."projectId" FROM project WHERE "organizationId" = NEW."organizationId";
  END IF;
  IF NEW."partitionId" IS NULL THEN
    SELECT "dataTenantId" INTO STRICT NEW."partitionId" FROM project WHERE id = NEW."projectId";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER usage_storage_partition_defaults BEFORE INSERT ON usage_storage_marker
FOR EACH ROW EXECUTE FUNCTION usage_partition_defaults();
CREATE TRIGGER usage_ingest_partition_defaults BEFORE INSERT ON usage_ingest_checkpoint
FOR EACH ROW EXECUTE FUNCTION usage_partition_defaults();

-- CreateIndex
CREATE UNIQUE INDEX "usage_storage_marker_partitionId_key" ON "usage_storage_marker"("partitionId");

-- CreateIndex
CREATE UNIQUE INDEX "usage_storage_marker_projectId_key" ON "usage_storage_marker"("projectId");

-- CreateIndex
CREATE INDEX "usage_ingest_checkpoint_partitionId_writtenAt_idx" ON "usage_ingest_checkpoint"("partitionId", "writtenAt");

-- CreateIndex
CREATE UNIQUE INDEX "project_dataTenantId_key" ON "project"("dataTenantId");

-- CreateIndex
CREATE INDEX "project_organizationId_idx" ON "project"("organizationId");

-- AddForeignKey
ALTER TABLE "usage_storage_marker" ADD CONSTRAINT "usage_storage_marker_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project" ADD CONSTRAINT "project_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_git_settings" ADD CONSTRAINT "project_git_settings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_git_webhook_secret" ADD CONSTRAINT "project_git_webhook_secret_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_legacy_settings" ADD CONSTRAINT "project_legacy_settings_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
