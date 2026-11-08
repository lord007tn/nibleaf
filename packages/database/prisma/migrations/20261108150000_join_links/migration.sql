-- Join links: shareable links that let someone join one site's organization
-- without an email invitation. Additive only: two new tables, no change to
-- existing rows. Tokens are stored as SHA-256 hashes, never in clear.

-- CreateTable
CREATE TABLE "join_link" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT,
    "role" TEXT NOT NULL DEFAULT 'member',
    "allowedDomain" TEXT,
    "maxUses" INTEGER,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "join_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "join_link_use" (
    "id" TEXT NOT NULL,
    "joinLinkId" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "join_link_use_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "join_link_tokenHash_key" ON "join_link"("tokenHash");

-- CreateIndex
CREATE INDEX "join_link_organizationId_idx" ON "join_link"("organizationId");

-- CreateIndex
CREATE INDEX "join_link_use_joinLinkId_createdAt_idx" ON "join_link_use"("joinLinkId", "createdAt");

-- CreateIndex
CREATE INDEX "join_link_use_userId_idx" ON "join_link_use"("userId");

-- AddForeignKey
ALTER TABLE "join_link" ADD CONSTRAINT "join_link_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "join_link" ADD CONSTRAINT "join_link_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "join_link_use" ADD CONSTRAINT "join_link_use_joinLinkId_fkey" FOREIGN KEY ("joinLinkId") REFERENCES "join_link"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "join_link_use" ADD CONSTRAINT "join_link_use_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
