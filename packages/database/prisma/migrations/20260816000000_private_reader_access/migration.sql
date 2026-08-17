-- Dedicated private-reader access. Existing public sites remain PUBLIC, while
-- legacy config.visibility=private sites retain their workspace-member policy.
CREATE TYPE "ProjectAccessMode" AS ENUM ('PUBLIC', 'WORKSPACE', 'READERS');

ALTER TABLE "project" ADD COLUMN "accessMode" "ProjectAccessMode" NOT NULL DEFAULT 'PUBLIC';
UPDATE "project" SET "accessMode" = 'WORKSPACE' WHERE "config"->>'visibility' = 'private';

CREATE TABLE "reader" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "email" TEXT,
  "name" TEXT,
  "externalSubject" TEXT,
  "status" TEXT NOT NULL DEFAULT 'INVITED',
  "invitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activatedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "reader_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "reader_projectId_email_key" ON "reader"("projectId", "email");
CREATE UNIQUE INDEX "reader_projectId_externalSubject_key" ON "reader"("projectId", "externalSubject");
CREATE INDEX "reader_projectId_status_idx" ON "reader"("projectId", "status");

CREATE TABLE "audience" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "audience_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "audience_projectId_name_key" ON "audience"("projectId", "name");
CREATE INDEX "audience_projectId_idx" ON "audience"("projectId");

CREATE TABLE "reader_audience" (
  "readerId" TEXT NOT NULL,
  "audienceId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reader_audience_pkey" PRIMARY KEY ("readerId", "audienceId")
);
CREATE INDEX "reader_audience_audienceId_idx" ON "reader_audience"("audienceId");

CREATE TABLE "audience_grant" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "audienceId" TEXT NOT NULL,
  "pageId" TEXT,
  "scopeKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audience_grant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "audience_grant_audienceId_scopeKey_key" ON "audience_grant"("audienceId", "scopeKey");
CREATE INDEX "audience_grant_projectId_pageId_idx" ON "audience_grant"("projectId", "pageId");

CREATE TABLE "reader_invitation" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "readerId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "acceptedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reader_invitation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "reader_invitation_tokenHash_key" ON "reader_invitation"("tokenHash");
CREATE INDEX "reader_invitation_projectId_expiresAt_idx" ON "reader_invitation"("projectId", "expiresAt");
CREATE INDEX "reader_invitation_readerId_idx" ON "reader_invitation"("readerId");

CREATE TABLE "reader_session" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "readerId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'INVITATION',
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "ipHash" TEXT,
  "userAgentHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reader_session_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "reader_session_tokenHash_key" ON "reader_session"("tokenHash");
CREATE INDEX "reader_session_projectId_expiresAt_idx" ON "reader_session"("projectId", "expiresAt");
CREATE INDEX "reader_session_readerId_revokedAt_idx" ON "reader_session"("readerId", "revokedAt");

CREATE TABLE "jwt_access_provider" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "issuer" TEXT NOT NULL,
  "audience" TEXT NOT NULL,
  "jwksUrl" TEXT,
  "publicJwks" JSONB,
  "subjectClaim" TEXT NOT NULL DEFAULT 'sub',
  "emailClaim" TEXT NOT NULL DEFAULT 'email',
  "nameClaim" TEXT NOT NULL DEFAULT 'name',
  "groupsClaim" TEXT NOT NULL DEFAULT 'groups',
  "claimMapping" JSONB,
  "sessionTtlMinutes" INTEGER NOT NULL DEFAULT 480,
  "maxTokenAgeSeconds" INTEGER NOT NULL DEFAULT 300,
  "clockToleranceSecs" INTEGER NOT NULL DEFAULT 30,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "jwt_access_provider_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "jwt_access_provider_projectId_key" ON "jwt_access_provider"("projectId");

CREATE TABLE "jwt_replay" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "jtiHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "jwt_replay_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "jwt_replay_projectId_jtiHash_key" ON "jwt_replay"("projectId", "jtiHash");
CREATE INDEX "jwt_replay_expiresAt_idx" ON "jwt_replay"("expiresAt");

CREATE TABLE "reader_audit_log" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "readerId" TEXT,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "metadata" JSONB,
  "ipHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "reader_audit_log_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "reader_audit_log_projectId_createdAt_idx" ON "reader_audit_log"("projectId", "createdAt");
CREATE INDEX "reader_audit_log_readerId_createdAt_idx" ON "reader_audit_log"("readerId", "createdAt");

ALTER TABLE "reader" ADD CONSTRAINT "reader_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audience" ADD CONSTRAINT "audience_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reader_audience" ADD CONSTRAINT "reader_audience_readerId_fkey" FOREIGN KEY ("readerId") REFERENCES "reader"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reader_audience" ADD CONSTRAINT "reader_audience_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "audience"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audience_grant" ADD CONSTRAINT "audience_grant_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audience_grant" ADD CONSTRAINT "audience_grant_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "audience"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audience_grant" ADD CONSTRAINT "audience_grant_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "page"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reader_invitation" ADD CONSTRAINT "reader_invitation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reader_invitation" ADD CONSTRAINT "reader_invitation_readerId_fkey" FOREIGN KEY ("readerId") REFERENCES "reader"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reader_session" ADD CONSTRAINT "reader_session_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reader_session" ADD CONSTRAINT "reader_session_readerId_fkey" FOREIGN KEY ("readerId") REFERENCES "reader"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "jwt_access_provider" ADD CONSTRAINT "jwt_access_provider_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "jwt_replay" ADD CONSTRAINT "jwt_replay_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reader_audit_log" ADD CONSTRAINT "reader_audit_log_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reader_audit_log" ADD CONSTRAINT "reader_audit_log_readerId_fkey" FOREIGN KEY ("readerId") REFERENCES "reader"("id") ON DELETE SET NULL ON UPDATE CASCADE;
