-- CreateEnum
CREATE TYPE "OpenApiSourceType" AS ENUM ('UPLOAD', 'URL', 'REPOSITORY');

-- CreateTable
CREATE TABLE "openapi_document" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "path" TEXT NOT NULL DEFAULT 'api-reference',
    "sourceType" "OpenApiSourceType" NOT NULL,
    "sourceUrl" TEXT,
    "sourcePath" TEXT,
    "document" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "openapi_document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "openapi_document_projectId_key" ON "openapi_document"("projectId");

-- AddForeignKey
ALTER TABLE "openapi_document" ADD CONSTRAINT "openapi_document_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
