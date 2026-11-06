-- Decisions and audit logs are append-only (corven_reject_mutation from 0001). Requests may only change status and decision fields.
CREATE FUNCTION corven_approval_request_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'approval requests are never deleted' USING ERRCODE = '23001'; END IF;
  IF NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id OR NEW.incident_id <> OLD.incident_id
     OR NEW.plan_reference_id <> OLD.plan_reference_id OR NEW.plan_version <> OLD.plan_version OR NEW.plan_hash <> OLD.plan_hash
     OR NEW.snapshot_hash <> OLD.snapshot_hash OR NEW.result_hash <> OLD.result_hash OR NEW.schema_version <> OLD.schema_version
     OR NEW.approval_digest <> OLD.approval_digest OR NEW.risk <> OLD.risk OR NEW.policy <> OLD.policy
     OR NEW.required_approvals <> OLD.required_approvals OR NEW.requested_by <> OLD.requested_by
     OR NEW.expires_at <> OLD.expires_at OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'the plan an approval is bound to cannot change' USING ERRCODE = '23001';
  END IF;
  IF OLD.status <> 'pending' AND NEW.status <> OLD.status AND NOT (OLD.status = 'approved' AND NEW.status = 'invalidated') THEN
    RAISE EXCEPTION 'a decided approval cannot change status' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER approval_requests_guard
  BEFORE UPDATE OR DELETE ON approval_requests
  FOR EACH ROW EXECUTE FUNCTION corven_approval_request_guard();
--> statement-breakpoint
CREATE TRIGGER approval_requests_no_truncate
  BEFORE TRUNCATE ON approval_requests
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER approval_decisions_append_only
  BEFORE UPDATE OR DELETE ON approval_decisions
  FOR EACH ROW EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER approval_decisions_no_truncate
  BEFORE TRUNCATE ON approval_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER approval_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON approval_audit_logs
  FOR EACH ROW EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER approval_audit_logs_no_truncate
  BEFORE TRUNCATE ON approval_audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
