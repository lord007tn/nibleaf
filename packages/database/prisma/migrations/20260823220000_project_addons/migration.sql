CREATE TABLE "project_addon" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL,
  "config" JSONB NOT NULL DEFAULT '{}',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_addon_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "project_addon_audit_event" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "addonKey" TEXT NOT NULL,
  "actorUserId" TEXT,
  "actorApiKeyId" TEXT,
  "action" TEXT NOT NULL,
  "previousEnabled" BOOLEAN,
  "nextEnabled" BOOLEAN NOT NULL,
  "previousConfig" JSONB,
  "nextConfig" JSONB NOT NULL,
  "revision" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_addon_audit_event_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_addon_projectId_key_key" ON "project_addon"("projectId", "key");
CREATE INDEX "project_addon_projectId_updatedAt_idx" ON "project_addon"("projectId", "updatedAt");
CREATE INDEX "project_addon_audit_event_projectId_createdAt_idx" ON "project_addon_audit_event"("projectId", "createdAt");
CREATE INDEX "project_addon_audit_event_projectId_addonKey_createdAt_idx" ON "project_addon_audit_event"("projectId", "addonKey", "createdAt");

ALTER TABLE "project_addon"
  ADD CONSTRAINT "project_addon_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_addon_audit_event"
  ADD CONSTRAINT "project_addon_audit_event_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill every registered capability. Legacy JSON is read only when its type
-- and value are recognized; malformed or unbounded fields use safe defaults.
INSERT INTO "project_addon" ("id", "projectId", "key", "enabled", "config", "revision")
SELECT
  md5(project."id" || ':' || definition."key"),
  project."id",
  definition."key",
  CASE definition."key"
    WHEN 'feedback' THEN COALESCE(CASE WHEN jsonb_typeof(project."config" #> '{addons,feedback}') = 'boolean' THEN (project."config" #>> '{addons,feedback}')::boolean END, TRUE)
    WHEN 'edit-suggestions' THEN COALESCE(CASE WHEN jsonb_typeof(project."config" #> '{addons,editSuggestions}') = 'boolean' THEN (project."config" #>> '{addons,editSuggestions}')::boolean END, TRUE)
    WHEN 'issue-links' THEN COALESCE(CASE WHEN jsonb_typeof(project."config" #> '{addons,issueLinks}') = 'boolean' THEN (project."config" #>> '{addons,issueLinks}')::boolean END, TRUE)
    WHEN 'consent-banner' THEN COALESCE(
      CASE WHEN jsonb_typeof(project."config" #> '{addons,consentBanner,enabled}') = 'boolean'
        THEN (project."config" #>> '{addons,consentBanner,enabled}')::boolean END,
      CASE WHEN jsonb_typeof(project."config" #> '{analytics,cookieConsent}') = 'boolean'
        THEN (project."config" #>> '{analytics,cookieConsent}')::boolean END,
      TRUE
    )
    WHEN 'ci-checks' THEN COALESCE(CASE WHEN jsonb_typeof(project."config" #> '{addons,ciChecks}') = 'boolean' THEN (project."config" #>> '{addons,ciChecks}')::boolean END, TRUE)
    WHEN 'broken-links' THEN COALESCE(CASE WHEN jsonb_typeof(project."config" #> '{addons,brokenLinks}') = 'boolean' THEN (project."config" #>> '{addons,brokenLinks}')::boolean END, TRUE)
    WHEN 'grammar-linter' THEN COALESCE(CASE WHEN jsonb_typeof(project."config" #> '{addons,grammarLinter}') = 'boolean' THEN (project."config" #>> '{addons,grammarLinter}')::boolean END, FALSE)
    WHEN 'preview-deployments' THEN COALESCE(CASE WHEN jsonb_typeof(project."config" #> '{addons,previewDeployments}') = 'boolean' THEN (project."config" #>> '{addons,previewDeployments}')::boolean END, TRUE)
  END,
  CASE definition."key"
    WHEN 'feedback' THEN jsonb_build_object(
      'placement', CASE WHEN project."config" #>> '{addons,feedbackPlacement}' IN ('after-content', 'after-navigation') THEN project."config" #>> '{addons,feedbackPlacement}' ELSE 'after-content' END,
      'presentation', CASE WHEN project."config" #>> '{addons,feedbackPresentation}' IN ('compact', 'card') THEN project."config" #>> '{addons,feedbackPresentation}' ELSE 'compact' END
    )
    WHEN 'edit-suggestions' THEN CASE
      WHEN jsonb_typeof(project."config" #> '{addons,editUrl}') = 'string'
        AND length(project."config" #>> '{addons,editUrl}') <= 500
        AND project."config" #>> '{addons,editUrl}' ~* '^https?://([a-z0-9-]+\.)*[a-z0-9-]+(:([0-9]{1,4}|[0-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]))?([/?#]|$)'
        AND regexp_replace(project."config" #>> '{addons,editUrl}', '\{(path|encodedPath)\}', '', 'g') !~ '[{}]'
        THEN jsonb_build_object('urlTemplate', project."config" #>> '{addons,editUrl}')
      ELSE '{}'::jsonb END
    WHEN 'issue-links' THEN CASE
      WHEN jsonb_typeof(project."config" #> '{addons,issueUrl}') = 'string'
        AND length(project."config" #>> '{addons,issueUrl}') <= 500
        AND project."config" #>> '{addons,issueUrl}' ~* '^https?://([a-z0-9-]+\.)*[a-z0-9-]+(:([0-9]{1,4}|[0-5][0-9]{4}|6[0-4][0-9]{3}|65[0-4][0-9]{2}|655[0-2][0-9]|6553[0-5]))?([/?#]|$)'
        AND regexp_replace(project."config" #>> '{addons,issueUrl}', '\{(url|path|encodedPath)\}', '', 'g') !~ '[{}]'
        THEN jsonb_build_object('urlTemplate', project."config" #>> '{addons,issueUrl}')
      ELSE '{}'::jsonb END
    WHEN 'consent-banner' THEN jsonb_build_object('placement', 'bottom-end', 'presentation', 'comfortable', 'buttonLayout', 'inline')
    ELSE '{}'::jsonb
  END,
  1
FROM "project" AS project
CROSS JOIN (VALUES
  ('feedback'), ('edit-suggestions'), ('issue-links'), ('consent-banner'),
  ('ci-checks'), ('broken-links'), ('grammar-linter'), ('preview-deployments')
) AS definition("key");

INSERT INTO "project_addon_audit_event" (
  "id", "projectId", "addonKey", "action", "previousEnabled", "nextEnabled", "previousConfig", "nextConfig", "revision"
)
SELECT
  md5(addon."id" || ':configured'), addon."projectId", addon."key", 'configured', NULL,
  addon."enabled", NULL, addon."config", addon."revision"
FROM "project_addon" AS addon;

-- Keep old consumers working while ProjectAddon becomes authoritative. The
-- application continues this projection transactionally after every mutation.
UPDATE "project" AS project
SET "config" = jsonb_set(
  jsonb_set(
    CASE WHEN jsonb_typeof(project."config") = 'object' THEN project."config" ELSE '{}'::jsonb END,
    '{addons}',
    ((CASE WHEN jsonb_typeof(project."config"->'addons') = 'object' THEN project."config"->'addons' ELSE '{}'::jsonb END) - 'editUrl' - 'issueUrl') || jsonb_build_object(
      'feedback', (SELECT "enabled" FROM "project_addon" WHERE "projectId" = project."id" AND "key" = 'feedback'),
      'feedbackPlacement', (SELECT "config"->>'placement' FROM "project_addon" WHERE "projectId" = project."id" AND "key" = 'feedback'),
      'feedbackPresentation', (SELECT "config"->>'presentation' FROM "project_addon" WHERE "projectId" = project."id" AND "key" = 'feedback'),
      'editSuggestions', (SELECT "enabled" FROM "project_addon" WHERE "projectId" = project."id" AND "key" = 'edit-suggestions'),
      'issueLinks', (SELECT "enabled" FROM "project_addon" WHERE "projectId" = project."id" AND "key" = 'issue-links'),
      'consentBanner', (SELECT jsonb_build_object('enabled', "enabled") || "config" FROM "project_addon" WHERE "projectId" = project."id" AND "key" = 'consent-banner'),
      'ciChecks', (SELECT "enabled" FROM "project_addon" WHERE "projectId" = project."id" AND "key" = 'ci-checks'),
      'brokenLinks', (SELECT "enabled" FROM "project_addon" WHERE "projectId" = project."id" AND "key" = 'broken-links'),
      'grammarLinter', (SELECT "enabled" FROM "project_addon" WHERE "projectId" = project."id" AND "key" = 'grammar-linter'),
      'previewDeployments', (SELECT "enabled" FROM "project_addon" WHERE "projectId" = project."id" AND "key" = 'preview-deployments')
    ) || jsonb_strip_nulls(jsonb_build_object(
      'editUrl', (SELECT "config"->>'urlTemplate' FROM "project_addon" WHERE "projectId" = project."id" AND "key" = 'edit-suggestions'),
      'issueUrl', (SELECT "config"->>'urlTemplate' FROM "project_addon" WHERE "projectId" = project."id" AND "key" = 'issue-links')
    )),
    TRUE
  ),
  '{analytics}',
  (CASE WHEN jsonb_typeof(project."config"->'analytics') = 'object' THEN project."config"->'analytics' ELSE '{}'::jsonb END) || jsonb_build_object(
    'cookieConsent', (SELECT "enabled" FROM "project_addon" WHERE "projectId" = project."id" AND "key" = 'consent-banner')
  ),
  TRUE
);
