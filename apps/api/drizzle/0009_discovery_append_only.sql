-- Reconciliation results and review decisions are append-only. Reuses corven_reject_mutation() from 0001.
CREATE TRIGGER discovery_results_append_only
  BEFORE UPDATE OR DELETE ON discovery_reconciliation_results
  FOR EACH ROW EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER discovery_results_no_truncate
  BEFORE TRUNCATE ON discovery_reconciliation_results
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER discovery_reviews_append_only
  BEFORE UPDATE OR DELETE ON discovery_reviews
  FOR EACH ROW EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER discovery_reviews_no_truncate
  BEFORE TRUNCATE ON discovery_reviews
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
