DROP TABLE IF EXISTS dependency_audit_logs;
DROP TABLE IF EXISTS dependency_versions;
DROP TABLE IF EXISTS dependencies;
DROP TABLE IF EXISTS resources;
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_id_org_unique;
