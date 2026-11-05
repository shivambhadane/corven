-- Dependency evidence is append-only. Reuses corven_reject_mutation() from 0001.
CREATE TRIGGER dependency_evidence_append_only
  BEFORE UPDATE OR DELETE ON dependency_evidence
  FOR EACH ROW EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER dependency_evidence_no_truncate
  BEFORE TRUNCATE ON dependency_evidence
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
