-- Workflow events are append-only; workflows are never deleted and keep their identity.
CREATE FUNCTION corven_workflow_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'workflows are never deleted' USING ERRCODE = '23001'; END IF;
  IF NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id OR NEW.incident_id <> OLD.incident_id OR NEW.started_by <> OLD.started_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'the identity of a workflow cannot change' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER incident_workflows_guard BEFORE UPDATE OR DELETE ON incident_workflows FOR EACH ROW EXECUTE FUNCTION corven_workflow_guard();
--> statement-breakpoint
CREATE TRIGGER incident_workflows_no_truncate BEFORE TRUNCATE ON incident_workflows FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_events_append_only BEFORE UPDATE OR DELETE ON workflow_events FOR EACH ROW EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER workflow_events_no_truncate BEFORE TRUNCATE ON workflow_events FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
