-- Append-only tables reuse corven_reject_mutation() from 0001. Tables that legitimately change once get a narrow guard instead.
CREATE FUNCTION corven_permissions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'permissions are never deleted' USING ERRCODE = '23001'; END IF;
  IF OLD.status <> 'active' OR NEW.status <> 'revoked'
     OR NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id OR NEW.agent_id <> OLD.agent_id
     OR NEW.resource_id <> OLD.resource_id OR NEW.action <> OLD.action OR NEW.constraints <> OLD.constraints
     OR NEW.granted_by <> OLD.granted_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'a permission can only be revoked, once' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION corven_credentials_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'credentials are never deleted' USING ERRCODE = '23001'; END IF;
  IF OLD.status <> 'active' OR NEW.status <> 'revoked'
     OR NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id OR NEW.agent_id <> OLD.agent_id
     OR NEW.secret_hash <> OLD.secret_hash OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'a credential can only be revoked, once' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION corven_execution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'execution records are never deleted' USING ERRCODE = '23001'; END IF;
  IF OLD.status <> 'pending' OR NEW.status = 'pending'
     OR NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id OR NEW.agent_id <> OLD.agent_id
     OR NEW.request_id <> OLD.request_id OR NEW.action <> OLD.action OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'an execution record is finalized exactly once' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION corven_enforcement_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'enforcement actions are never deleted' USING ERRCODE = '23001'; END IF;
  IF NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id OR NEW.kind <> OLD.kind
     OR NEW.agent_id IS DISTINCT FROM OLD.agent_id OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
     OR NEW.incident_id IS DISTINCT FROM OLD.incident_id OR NEW.plan_hash IS DISTINCT FROM OLD.plan_hash
     OR NEW.requested_by <> OLD.requested_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'the identity of an enforcement action cannot change' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER credential_rotation_history_append_only
  BEFORE UPDATE OR DELETE ON credential_rotation_history
  FOR EACH ROW EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER credential_rotation_history_no_truncate
  BEFORE TRUNCATE ON credential_rotation_history
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER gateway_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON gateway_audit_logs
  FOR EACH ROW EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER gateway_audit_logs_no_truncate
  BEFORE TRUNCATE ON gateway_audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER gateway_decisions_append_only
  BEFORE UPDATE OR DELETE ON gateway_decisions
  FOR EACH ROW EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER gateway_decisions_no_truncate
  BEFORE TRUNCATE ON gateway_decisions
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER enforcement_action_events_append_only
  BEFORE UPDATE OR DELETE ON enforcement_action_events
  FOR EACH ROW EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER enforcement_action_events_no_truncate
  BEFORE TRUNCATE ON enforcement_action_events
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER permissions_guard
  BEFORE UPDATE OR DELETE ON permissions
  FOR EACH ROW EXECUTE FUNCTION corven_permissions_guard();
--> statement-breakpoint
CREATE TRIGGER permissions_no_truncate
  BEFORE TRUNCATE ON permissions
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER agent_credentials_guard
  BEFORE UPDATE OR DELETE ON agent_credentials
  FOR EACH ROW EXECUTE FUNCTION corven_credentials_guard();
--> statement-breakpoint
CREATE TRIGGER agent_credentials_no_truncate
  BEFORE TRUNCATE ON agent_credentials
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER execution_records_guard
  BEFORE UPDATE OR DELETE ON execution_records
  FOR EACH ROW EXECUTE FUNCTION corven_execution_guard();
--> statement-breakpoint
CREATE TRIGGER execution_records_no_truncate
  BEFORE TRUNCATE ON execution_records
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER enforcement_actions_guard
  BEFORE UPDATE OR DELETE ON enforcement_actions
  FOR EACH ROW EXECUTE FUNCTION corven_enforcement_guard();
--> statement-breakpoint
CREATE TRIGGER enforcement_actions_no_truncate
  BEFORE TRUNCATE ON enforcement_actions
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
