DROP TRIGGER IF EXISTS agent_status_history_no_truncate ON agent_status_history;
DROP TRIGGER IF EXISTS agent_status_history_append_only ON agent_status_history;
DROP TRIGGER IF EXISTS agent_audit_logs_no_truncate ON agent_audit_logs;
DROP TRIGGER IF EXISTS agent_audit_logs_append_only ON agent_audit_logs;
DROP FUNCTION IF EXISTS corven_reject_mutation();
