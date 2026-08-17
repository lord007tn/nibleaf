-- Durable two-way Git state. Existing organization.metadata.git remains intact
-- and is lazily adopted by the API, preserving all one-way connections.
CREATE TABLE "git_connection" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'github',
    "repository" TEXT NOT NULL,
    "baseBranch" TEXT NOT NULL DEFAULT 'main',
    "headBranch" TEXT NOT NULL,
    "contentPath" TEXT NOT NULL DEFAULT '',
    "importBranchId" TEXT,
    "importLanguageId" TEXT,
    "credentialEncrypted" TEXT,
    "credentialFingerprint" TEXT,
    "webhookSecretEncrypted" TEXT,
    "remoteBaseSha" TEXT,
    "remoteHeadSha" TEXT,
    "lastSyncStatus" TEXT NOT NULL DEFAULT 'IDLE',
    "lastSyncError" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "git_connection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "git_sync_operation" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "requestedById" TEXT,
    "baseBranch" TEXT NOT NULL,
    "headBranch" TEXT NOT NULL,
    "commitMessage" TEXT,
    "authorName" TEXT,
    "authorEmail" TEXT,
    "request" JSONB,
    "changedFiles" JSONB,
    "remoteSha" TEXT,
    "pullRequestNo" INTEGER,
    "pullRequestUrl" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "git_sync_operation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "git_file_state" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "pageId" TEXT,
    "branchId" TEXT,
    "languageId" TEXT,
    "baseContent" TEXT,
    "baseExists" BOOLEAN NOT NULL DEFAULT true,
    "baseBlobSha" TEXT,
    "remoteBlobSha" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "git_file_state_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "git_conflict" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "baseContent" TEXT,
    "oursContent" TEXT,
    "theirsContent" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedContent" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "git_conflict_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "git_pull_request" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'open',
    "draft" BOOLEAN NOT NULL DEFAULT true,
    "baseBranch" TEXT NOT NULL,
    "headBranch" TEXT NOT NULL,
    "headSha" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "git_pull_request_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "git_preview" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "pullRequestId" TEXT,
    "token" TEXT NOT NULL,
    "sourceSha" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "snapshot" JSONB,
    "url" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "git_preview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "git_webhook_delivery" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "providerDeliveryId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACCEPTED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "git_webhook_delivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "git_audit_event" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT,
    "projectId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "git_audit_event_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "git_connection_projectId_key" ON "git_connection"("projectId");
CREATE INDEX "git_connection_provider_repository_idx" ON "git_connection"("provider", "repository");
CREATE UNIQUE INDEX "git_sync_operation_connectionId_idempotencyKey_key" ON "git_sync_operation"("connectionId", "idempotencyKey");
CREATE INDEX "git_sync_operation_connectionId_createdAt_idx" ON "git_sync_operation"("connectionId", "createdAt");
CREATE INDEX "git_sync_operation_status_idx" ON "git_sync_operation"("status");
CREATE UNIQUE INDEX "git_file_state_connectionId_path_key" ON "git_file_state"("connectionId", "path");
CREATE INDEX "git_file_state_connectionId_pageId_idx" ON "git_file_state"("connectionId", "pageId");
CREATE UNIQUE INDEX "git_conflict_operationId_path_key" ON "git_conflict"("operationId", "path");
CREATE INDEX "git_conflict_status_idx" ON "git_conflict"("status");
CREATE UNIQUE INDEX "git_pull_request_connectionId_number_key" ON "git_pull_request"("connectionId", "number");
CREATE UNIQUE INDEX "git_pull_request_connectionId_headBranch_key" ON "git_pull_request"("connectionId", "headBranch");
CREATE UNIQUE INDEX "git_preview_token_key" ON "git_preview"("token");
CREATE UNIQUE INDEX "git_preview_connectionId_sourceSha_key" ON "git_preview"("connectionId", "sourceSha");
CREATE INDEX "git_preview_projectId_status_idx" ON "git_preview"("projectId", "status");
CREATE UNIQUE INDEX "git_webhook_delivery_connectionId_providerDeliveryId_key" ON "git_webhook_delivery"("connectionId", "providerDeliveryId");
CREATE INDEX "git_webhook_delivery_status_receivedAt_idx" ON "git_webhook_delivery"("status", "receivedAt");
CREATE INDEX "git_audit_event_projectId_createdAt_idx" ON "git_audit_event"("projectId", "createdAt");
CREATE INDEX "git_audit_event_connectionId_createdAt_idx" ON "git_audit_event"("connectionId", "createdAt");

ALTER TABLE "git_connection" ADD CONSTRAINT "git_connection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "git_sync_operation" ADD CONSTRAINT "git_sync_operation_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "git_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "git_file_state" ADD CONSTRAINT "git_file_state_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "git_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "git_conflict" ADD CONSTRAINT "git_conflict_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "git_sync_operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "git_pull_request" ADD CONSTRAINT "git_pull_request_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "git_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "git_preview" ADD CONSTRAINT "git_preview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "git_preview" ADD CONSTRAINT "git_preview_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "git_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "git_preview" ADD CONSTRAINT "git_preview_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "git_pull_request"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "git_webhook_delivery" ADD CONSTRAINT "git_webhook_delivery_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "git_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "git_audit_event" ADD CONSTRAINT "git_audit_event_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "git_connection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
