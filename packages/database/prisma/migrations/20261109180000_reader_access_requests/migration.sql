-- AlterTable
ALTER TABLE "project" ADD COLUMN     "readerAccessRequests" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "reader_access_request" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,

    CONSTRAINT "reader_access_request_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reader_access_request_projectId_status_createdAt_idx" ON "reader_access_request"("projectId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "reader_access_request_projectId_email_key" ON "reader_access_request"("projectId", "email");

-- AddForeignKey
ALTER TABLE "reader_access_request" ADD CONSTRAINT "reader_access_request_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

