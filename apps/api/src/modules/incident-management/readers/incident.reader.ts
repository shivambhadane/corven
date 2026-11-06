import type { Database } from "../../../db/client.js";
import type { IncidentRepository } from "../repositories/incident.repository.js";
import type { AnalysisReference, Incident } from "../types.js";

/**
 * Read-only, organization-explicit access for the modules that come next
 * (Approval, Gateway, Verification, Evidence). Like AgentRegistryReader it takes
 * an organization id, which callers must obtain from their own authenticated
 * context. Writes go through IncidentService as the `system` principal.
 */
export class IncidentReader {
  constructor(
    private readonly db: Database,
    private readonly repo: IncidentRepository,
  ) {}

  getIncident(organizationId: string, incidentId: string): Promise<Incident | null> {
    return this.repo.find(this.db, organizationId, incidentId);
  }

  /** The plan reference currently in force, or null. The plan hash is what an approval must bind to. */
  async getCurrentPlanReference(organizationId: string, incidentId: string): Promise<AnalysisReference | null> {
    const inc = await this.getIncident(organizationId, incidentId);
    return inc?.currentPlanRefId ? this.repo.findRef(this.db, organizationId, incidentId, inc.currentPlanRefId) : null;
  }

  async getCurrentSnapshotReference(organizationId: string, incidentId: string): Promise<AnalysisReference | null> {
    const inc = await this.getIncident(organizationId, incidentId);
    return inc?.currentSnapshotRefId ? this.repo.findRef(this.db, organizationId, incidentId, inc.currentSnapshotRefId) : null;
  }
}
