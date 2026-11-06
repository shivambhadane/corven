DROP TRIGGER IF EXISTS approval_audit_logs_no_truncate ON approval_audit_logs;
DROP TRIGGER IF EXISTS approval_audit_logs_append_only ON approval_audit_logs;
DROP TRIGGER IF EXISTS approval_decisions_no_truncate ON approval_decisions;
DROP TRIGGER IF EXISTS approval_decisions_append_only ON approval_decisions;
DROP TRIGGER IF EXISTS approval_requests_no_truncate ON approval_requests;
DROP TRIGGER IF EXISTS approval_requests_guard ON approval_requests;
DROP FUNCTION IF EXISTS corven_approval_request_guard();
