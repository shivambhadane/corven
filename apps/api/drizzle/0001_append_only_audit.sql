-- Audit and status-history tables are append-only. Any UPDATE, DELETE or
-- TRUNCATE is rejected at the database level, regardless of application code.
CREATE FUNCTION corven_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER agent_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON agent_audit_logs
  FOR EACH ROW EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER agent_audit_logs_no_truncate
  BEFORE TRUNCATE ON agent_audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER agent_status_history_append_only
  BEFORE UPDATE OR DELETE ON agent_status_history
  FOR EACH ROW EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER agent_status_history_no_truncate
  BEFORE TRUNCATE ON agent_status_history
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
