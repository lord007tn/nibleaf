-- Manual rollback for operators who must return to a pre-add-on application.
-- This preserves the state representable by the pre-add-on Project.config
-- schema before removing the new tables. Placement and presentation controls
-- did not exist in that schema and are intentionally discarded. Stop
-- application writes first.
UPDATE "project" AS project
SET "config" = jsonb_set(
  jsonb_set(
    CASE WHEN jsonb_typeof(project."config") = 'object' THEN project."config" ELSE '{}'::jsonb END,
    '{addons}',
    ((CASE WHEN jsonb_typeof(project."config"->'addons') = 'object' THEN project."config"->'addons' ELSE '{}'::jsonb END)
      - 'editUrl' - 'issueUrl' - 'feedbackPlacement' - 'feedbackPresentation' - 'consentBanner') || jsonb_build_object(
      'feedback', (SELECT "enabled" FROM "project_addon" WHERE "projectId" = project."id" AND "key" = 'feedback'),
      'editSuggestions', (SELECT "enabled" FROM "project_addon" WHERE "projectId" = project."id" AND "key" = 'edit-suggestions'),
      'issueLinks', (SELECT "enabled" FROM "project_addon" WHERE "projectId" = project."id" AND "key" = 'issue-links'),
      'ciChecks', (SELECT "enabled" FROM "project_addon" WHERE "projectId" = project."id" AND "key" = 'ci-checks'),
      'brokenLinks', (SELECT "enabled" FROM "project_addon" WHERE "projectId" = project."id" AND "key" = 'broken-links'),
      'grammarLinter', (SELECT "enabled" FROM "project_addon" WHERE "projectId" = project."id" AND "key" = 'grammar-linter'),
      'previewDeployments', (SELECT "enabled" FROM "project_addon" WHERE "projectId" = project."id" AND "key" = 'preview-deployments')
    ) || jsonb_strip_nulls(jsonb_build_object(
      'editUrl', (SELECT "config"->>'urlTemplate' FROM "project_addon" WHERE "projectId" = project."id" AND "key" = 'edit-suggestions'),
      'issueUrl', (SELECT "config"->>'urlTemplate' FROM "project_addon" WHERE "projectId" = project."id" AND "key" = 'issue-links')
    )), TRUE
  ),
  '{analytics}',
  (CASE WHEN jsonb_typeof(project."config"->'analytics') = 'object' THEN project."config"->'analytics' ELSE '{}'::jsonb END) || jsonb_build_object(
    'cookieConsent', (SELECT "enabled" FROM "project_addon" WHERE "projectId" = project."id" AND "key" = 'consent-banner')
  ), TRUE
)
WHERE EXISTS (SELECT 1 FROM "project_addon" WHERE "projectId" = project."id");

DROP TABLE "project_addon_audit_event";
DROP TABLE "project_addon";
