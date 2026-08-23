CREATE TABLE "usage_plan" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "usage_plan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "usage_meter" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "unit" TEXT NOT NULL,
  "aggregation" TEXT NOT NULL DEFAULT 'sum',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "usage_meter_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "usage_plan_meter" (
  "planId" TEXT NOT NULL,
  "meterId" TEXT NOT NULL,
  "limit" BIGINT,
  "behavior" TEXT NOT NULL DEFAULT 'observe',
  "warningRatio" INTEGER NOT NULL DEFAULT 80,
  CONSTRAINT "usage_plan_meter_pkey" PRIMARY KEY ("planId", "meterId")
);

CREATE TABLE "usage_entitlement" (
  "id" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "capabilityKey" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL,
  "limit" BIGINT,
  "meterId" TEXT,
  "behavior" TEXT NOT NULL DEFAULT 'observe',
  CONSTRAINT "usage_entitlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "organization_usage_plan" (
  "organizationId" TEXT NOT NULL,
  "planId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "organization_usage_plan_pkey" PRIMARY KEY ("organizationId")
);

CREATE TABLE "usage_provider_checkpoint" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "reconciliationId" TEXT NOT NULL,
  "meterKey" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "quantity" DECIMAL(38,0) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "lastAttemptAt" TIMESTAMP(3),
  "acceptedAt" TIMESTAMP(3),
  "hasError" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "usage_provider_checkpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "usage_storage_marker" (
  "organizationId" TEXT NOT NULL,
  "firstWrittenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastWrittenAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "usage_storage_marker_pkey" PRIMARY KEY ("organizationId")
);

CREATE UNIQUE INDEX "usage_plan_key_key" ON "usage_plan"("key");
CREATE UNIQUE INDEX "usage_meter_key_key" ON "usage_meter"("key");
CREATE UNIQUE INDEX "usage_entitlement_planId_capabilityKey_key" ON "usage_entitlement"("planId", "capabilityKey");
CREATE INDEX "organization_usage_plan_planId_idx" ON "organization_usage_plan"("planId");
CREATE UNIQUE INDEX "usage_provider_checkpoint_reconciliationId_key" ON "usage_provider_checkpoint"("reconciliationId");
CREATE INDEX "usage_provider_checkpoint_organizationId_periodStart_periodEnd_idx" ON "usage_provider_checkpoint"("organizationId", "periodStart", "periodEnd");
CREATE INDEX "usage_provider_checkpoint_provider_status_idx" ON "usage_provider_checkpoint"("provider", "status");

ALTER TABLE "usage_plan_meter" ADD CONSTRAINT "usage_plan_meter_planId_fkey" FOREIGN KEY ("planId") REFERENCES "usage_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usage_plan_meter" ADD CONSTRAINT "usage_plan_meter_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "usage_meter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usage_entitlement" ADD CONSTRAINT "usage_entitlement_planId_fkey" FOREIGN KEY ("planId") REFERENCES "usage_plan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usage_entitlement" ADD CONSTRAINT "usage_entitlement_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "usage_meter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "organization_usage_plan" ADD CONSTRAINT "organization_usage_plan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "organization_usage_plan" ADD CONSTRAINT "organization_usage_plan_planId_fkey" FOREIGN KEY ("planId") REFERENCES "usage_plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "usage_storage_marker" ADD CONSTRAINT "usage_storage_marker_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "usage_plan" ("id", "key", "name", "version", "active", "createdAt", "updatedAt")
VALUES ('usage_plan_free_v1', 'free', 'Free', 1, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "organization_usage_plan" ("organizationId", "planId", "status", "effectiveAt", "createdAt", "updatedAt")
SELECT organization."id", free_plan."id", 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "organization" AS organization
CROSS JOIN "usage_plan" AS free_plan
WHERE free_plan."key" = 'free'
ON CONFLICT ("organizationId") DO NOTHING;
