-- AlterTable
ALTER TABLE "project" ADD COLUMN     "readerEmailDomains" TEXT[] DEFAULT ARRAY[]::TEXT[];

