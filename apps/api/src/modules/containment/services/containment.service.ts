import { assertCan } from "../../../auth/permissions.js";
import type { Principal } from "../../../auth/principal.js";
import { analyzeBlastRadius } from "../../blast-radius/core/analyze.js";
import type { GraphLoader } from "../../blast-radius/services/blast-radius.service.js";
import { planContainment } from "../core/plan.js";
import type { ContainmentInput, ContainmentPlan } from "../types.js";

export interface PlanRequest extends Omit<ContainmentInput, "protectedNodeIds"> {
  /** Omitted: every resource the blast-radius analysis marks as exposed. */
  protectedNodeIds?: string[] | undefined;
  snapshotId?: string | undefined;
}

/**
 * Computes a containment plan on demand. It stores nothing: a plan is a
 * proposal. Persisting, approving and executing plans belong to Incident
 * Management, Approval and the Gateway.
 */
export class ContainmentService {
  constructor(private readonly graphs: GraphLoader) {}

  async plan(principal: Principal, req: PlanRequest): Promise<{ plan: ContainmentPlan; protectedWasDefaulted: boolean }> {
    assertCan(principal, "analysis:read");
    const graph = await this.graphs.load(principal, req.snapshotId);
    let protectedNodeIds = req.protectedNodeIds;
    const defaulted = protectedNodeIds === undefined || protectedNodeIds.length === 0;
    if (defaulted) {
      const blast = analyzeBlastRadius(graph, req.sourceNodeIds, req.options ?? {});
      protectedNodeIds = blast.impacted.filter((n) => n.classification === "exposed" && n.nodeId.startsWith("resource:")).map((n) => n.nodeId);
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to omit
    const { snapshotId: _s, protectedNodeIds: _p, ...rest } = req;
    const plan = planContainment(graph, { ...rest, protectedNodeIds: protectedNodeIds ?? [] });
    return { plan, protectedWasDefaulted: defaulted };
  }
}
