-- Graph snapshots are immutable. Reuses corven_reject_mutation() from 0001.
CREATE TRIGGER graph_snapshots_append_only
  BEFORE UPDATE OR DELETE ON graph_snapshots
  FOR EACH ROW EXECUTE FUNCTION corven_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER graph_snapshots_no_truncate
  BEFORE TRUNCATE ON graph_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION corven_reject_mutation();
