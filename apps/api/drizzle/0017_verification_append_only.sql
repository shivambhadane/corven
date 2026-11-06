-- Checks are append-only. A run reaches a final status once and its evidence (checks, result hash) never changes afterwards.
CREATE FUNCTION corven_verification_run_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'verification runs are never deleted' USING ERRCODE = '23001'; END IF;
  IF NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id OR NEW.incident_id <> OLD.incident_id
     OR NEW.plan_reference_id <> OLD.plan_reference_id OR NEW.plan_hash <> OLD.plan_hash OR NEW.snapshot_hash <> OLD.snapshot_hash
     OR NEW.attempt <> OLD.attempt OR NEW.requested_by <> OLD.requested_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'the identity of a verification run cannot change' USING ERRCODE = '23001';
  END IF;
  IF OLD.status NOT IN ('pending','running') AND (NEW.status <> OLD.status OR NEW.result_hash IS DISTINCT FROM OLD.result_hash OR NEW.summary IS DISTINCT FROM OLD.summary) THEN
    RAISE EXCEPTION 'a completed verification run is final' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER verification_runs_guard
  BEFORE UPDATE OR DELETE ON verification_runs
  FOR EACH ROW EXECUTE FUNCTION corven_verification_run_guard();
--> statement-breakpoint
CREATE TRIGGER verification_runs_no_truncate
  BEFORE TRUNCATE ON verification_runs
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER verification_checks_append_only
  BEFORE UPDATE OR DELETE ON verification_checks
  FOR EACH ROW EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER verification_checks_no_truncate
  BEFORE TRUNCATE ON verification_checks
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
