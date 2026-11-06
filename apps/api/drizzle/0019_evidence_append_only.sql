-- Evidence content and hash are frozen at creation. Status may move, but `invalid` is terminal. Logs are append-only.
CREATE FUNCTION corven_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'evidence is never deleted' USING ERRCODE = '23001'; END IF;
  IF NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id OR NEW.incident_id <> OLD.incident_id OR NEW.sequence <> OLD.sequence
     OR NEW.schema_version <> OLD.schema_version OR NEW.content <> OLD.content OR NEW.content_hash <> OLD.content_hash
     OR NEW.previous_hash IS DISTINCT FROM OLD.previous_hash OR NEW.previous_evidence_id IS DISTINCT FROM OLD.previous_evidence_id
     OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'sealed evidence cannot change' USING ERRCODE = '23001';
  END IF;
  IF OLD.status = 'invalid' AND NEW.status <> 'invalid' THEN
    RAISE EXCEPTION 'invalid evidence stays invalid' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE FUNCTION corven_evidence_anchor_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'anchors are never deleted' USING ERRCODE = '23001'; END IF;
  IF NEW.evidence_id <> OLD.evidence_id OR NEW.target <> OLD.target OR NEW.anchored_hash <> OLD.anchored_hash OR NEW.organization_id <> OLD.organization_id THEN
    RAISE EXCEPTION 'what an anchor anchors cannot change' USING ERRCODE = '23001';
  END IF;
  IF OLD.status = 'confirmed' AND (NEW.status <> 'confirmed' OR NEW.external_reference IS DISTINCT FROM OLD.external_reference) THEN
    RAISE EXCEPTION 'a confirmed anchor is final' USING ERRCODE = '23001';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER evidence_records_guard BEFORE UPDATE OR DELETE ON evidence_records FOR EACH ROW EXECUTE FUNCTION corven_evidence_guard();
--> statement-breakpoint
CREATE TRIGGER evidence_records_no_truncate BEFORE TRUNCATE ON evidence_records FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER evidence_anchors_guard BEFORE UPDATE OR DELETE ON evidence_anchors FOR EACH ROW EXECUTE FUNCTION corven_evidence_anchor_guard();
--> statement-breakpoint
CREATE TRIGGER evidence_anchors_no_truncate BEFORE TRUNCATE ON evidence_anchors FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER evidence_verification_logs_append_only BEFORE UPDATE OR DELETE ON evidence_verification_logs FOR EACH ROW EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER evidence_verification_logs_no_truncate BEFORE TRUNCATE ON evidence_verification_logs FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
