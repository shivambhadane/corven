DROP TRIGGER IF EXISTS evidence_verification_logs_no_truncate ON evidence_verification_logs;
DROP TRIGGER IF EXISTS evidence_verification_logs_append_only ON evidence_verification_logs;
DROP TRIGGER IF EXISTS evidence_anchors_no_truncate ON evidence_anchors;
DROP TRIGGER IF EXISTS evidence_anchors_guard ON evidence_anchors;
DROP TRIGGER IF EXISTS evidence_records_no_truncate ON evidence_records;
DROP TRIGGER IF EXISTS evidence_records_guard ON evidence_records;
DROP FUNCTION IF EXISTS corven_evidence_anchor_guard();
DROP FUNCTION IF EXISTS corven_evidence_guard();
