DROP TRIGGER IF EXISTS verification_checks_no_truncate ON verification_checks;
DROP TRIGGER IF EXISTS verification_checks_append_only ON verification_checks;
DROP TRIGGER IF EXISTS verification_runs_no_truncate ON verification_runs;
DROP TRIGGER IF EXISTS verification_runs_guard ON verification_runs;
DROP FUNCTION IF EXISTS corven_verification_run_guard();
