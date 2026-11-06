DROP TRIGGER IF EXISTS workflow_events_no_truncate ON workflow_events;
DROP TRIGGER IF EXISTS workflow_events_append_only ON workflow_events;
DROP TRIGGER IF EXISTS incident_workflows_no_truncate ON incident_workflows;
DROP TRIGGER IF EXISTS incident_workflows_guard ON incident_workflows;
DROP FUNCTION IF EXISTS corven_workflow_guard();
