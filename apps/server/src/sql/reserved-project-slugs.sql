-- $1 is the text[] of configured system-host labels from the shared hostname rule.
WITH reserved(slug) AS (
  SELECT unnest(ARRAY['www', 'admin', 'api', 'app', 'docs', 'storage', 'cname', 'status', 'mail']::text[] || COALESCE($1::text[], '{}'::text[]))
)
SELECT p.id, p."organizationId", p.slug
FROM project AS p
WHERE lower(p.slug) IN (SELECT lower(slug) FROM reserved)
   OR lower(p.slug) LIKE 'xn--%'
ORDER BY p.slug, p.id;
