DROP TABLE IF EXISTS approval_audit_logs;
DROP TABLE IF EXISTS approval_decisions;
DROP TABLE IF EXISTS approval_requests;
DROP TABLE IF EXISTS approval_policies;
ALTER TABLE incident_analysis_references DROP CONSTRAINT IF EXISTS incident_analysis_refs_id_org_unique;
