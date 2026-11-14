-- Optional metadata only: previous releases can continue reading and writing assets.
ALTER TABLE "asset" ADD COLUMN "width" INTEGER, ADD COLUMN "height" INTEGER;
