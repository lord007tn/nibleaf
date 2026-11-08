-- CreateTable
CREATE TABLE "site_sign_in_code" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_sign_in_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_member_session" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "site_member_session_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "site_sign_in_code_projectId_email_createdAt_idx" ON "site_sign_in_code"("projectId", "email", "createdAt");

-- CreateIndex
CREATE INDEX "site_sign_in_code_expiresAt_idx" ON "site_sign_in_code"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "site_member_session_tokenHash_key" ON "site_member_session"("tokenHash");

-- CreateIndex
CREATE INDEX "site_member_session_projectId_userId_idx" ON "site_member_session"("projectId", "userId");

-- AddForeignKey
ALTER TABLE "site_sign_in_code" ADD CONSTRAINT "site_sign_in_code_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_member_session" ADD CONSTRAINT "site_member_session_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "site_member_session" ADD CONSTRAINT "site_member_session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

