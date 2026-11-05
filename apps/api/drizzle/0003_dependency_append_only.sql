-- Version history and audit log are append-only at the database level.
-- Reuses corven_reject_mutation() from migration 0001.
CREATE TRIGGER dependency_versions_append_only
  BEFORE UPDATE OR DELETE ON dependency_versions
  FOR EACH ROW EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER dependency_versions_no_truncate
  BEFORE TRUNCATE ON dependency_versions
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER dependency_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON dependency_audit_logs
  FOR EACH ROW EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER dependency_audit_logs_no_truncate
  BEFORE TRUNCATE ON dependency_audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
