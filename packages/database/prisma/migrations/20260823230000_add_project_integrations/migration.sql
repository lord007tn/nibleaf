-- AlterTable
ALTER TABLE "api_key" ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "project_integration" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "config" JSONB,
    "credentialEncrypted" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "lastVerificationStatus" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "lastVerificationCode" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_integration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_audit_event" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT,
    "projectId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "principalType" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "code" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_confirmation" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "connectionId" TEXT,
    "providerId" TEXT NOT NULL,
    "connectionRevision" INTEGER NOT NULL,
    "principalType" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "tokenDigest" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_confirmation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_webhook_delivery" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "eventVersion" INTEGER NOT NULL DEFAULT 1,
    "idempotencyDigest" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "responseStatus" INTEGER,
    "errorCode" TEXT,
    "result" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "integration_webhook_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_idempotency_record" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "keyDigest" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "connectionId" TEXT,
    "resultRevision" INTEGER,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_idempotency_record_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_integration_projectId_status_idx" ON "project_integration"("projectId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "project_integration_projectId_providerId_key" ON "project_integration"("projectId", "providerId");

-- CreateIndex
CREATE INDEX "integration_audit_event_projectId_createdAt_idx" ON "integration_audit_event"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "integration_audit_event_projectId_providerId_createdAt_idx" ON "integration_audit_event"("projectId", "providerId", "createdAt");

-- CreateIndex
CREATE INDEX "integration_audit_event_connectionId_createdAt_idx" ON "integration_audit_event"("connectionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "integration_confirmation_tokenDigest_key" ON "integration_confirmation"("tokenDigest");

-- CreateIndex
CREATE INDEX "integration_confirmation_projectId_expiresAt_idx" ON "integration_confirmation"("projectId", "expiresAt");

-- CreateIndex
CREATE INDEX "integration_confirmation_projectId_consumedAt_idx" ON "integration_confirmation"("projectId", "consumedAt");

-- CreateIndex
CREATE INDEX "integration_webhook_delivery_status_startedAt_idx" ON "integration_webhook_delivery"("status", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "integration_webhook_delivery_connectionId_idempotencyDigest_key" ON "integration_webhook_delivery"("connectionId", "idempotencyDigest");

-- CreateIndex
CREATE INDEX "integration_idempotency_record_projectId_expiresAt_idx" ON "integration_idempotency_record"("projectId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "integration_idempotency_record_projectId_providerId_action__key" ON "integration_idempotency_record"("projectId", "providerId", "action", "keyDigest");

-- AddForeignKey
ALTER TABLE "project_integration" ADD CONSTRAINT "project_integration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_audit_event" ADD CONSTRAINT "integration_audit_event_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "project_integration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_audit_event" ADD CONSTRAINT "integration_audit_event_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_confirmation" ADD CONSTRAINT "integration_confirmation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_confirmation" ADD CONSTRAINT "integration_confirmation_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "project_integration"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_webhook_delivery" ADD CONSTRAINT "integration_webhook_delivery_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "project_integration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_idempotency_record" ADD CONSTRAINT "integration_idempotency_record_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
