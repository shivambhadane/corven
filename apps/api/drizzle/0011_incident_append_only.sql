-- Incident history, associations, notes and analysis references are append-only. Reuses corven_reject_mutation() from 0001.
CREATE TRIGGER incident_state_history_append_only
  BEFORE UPDATE OR DELETE ON incident_state_history
  FOR EACH ROW EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER incident_state_history_no_truncate
  BEFORE TRUNCATE ON incident_state_history
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER incident_events_append_only
  BEFORE UPDATE OR DELETE ON incident_events
  FOR EACH ROW EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER incident_events_no_truncate
  BEFORE TRUNCATE ON incident_events
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER incident_audit_logs_append_only
  BEFORE UPDATE OR DELETE ON incident_audit_logs
  FOR EACH ROW EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER incident_audit_logs_no_truncate
  BEFORE TRUNCATE ON incident_audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER incident_agents_append_only
  BEFORE UPDATE OR DELETE ON incident_agents
  FOR EACH ROW EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER incident_agents_no_truncate
  BEFORE TRUNCATE ON incident_agents
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER incident_resources_append_only
  BEFORE UPDATE OR DELETE ON incident_resources
  FOR EACH ROW EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER incident_resources_no_truncate
  BEFORE TRUNCATE ON incident_resources
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER incident_assignments_append_only
  BEFORE UPDATE OR DELETE ON incident_assignments
  FOR EACH ROW EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER incident_assignments_no_truncate
  BEFORE TRUNCATE ON incident_assignments
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER incident_notes_append_only
  BEFORE UPDATE OR DELETE ON incident_notes
  FOR EACH ROW EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER incident_notes_no_truncate
  BEFORE TRUNCATE ON incident_notes
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER incident_analysis_references_append_only
  BEFORE UPDATE OR DELETE ON incident_analysis_references
  FOR EACH ROW EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER incident_analysis_references_no_truncate
  BEFORE TRUNCATE ON incident_analysis_references
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
