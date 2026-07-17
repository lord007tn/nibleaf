-- Language serving toggle: disabled languages stay editable in the dashboard
-- but are hidden from every public surface of the published site.
ALTER TABLE "language" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true;
