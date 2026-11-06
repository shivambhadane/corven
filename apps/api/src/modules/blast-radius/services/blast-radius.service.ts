import { assertCan } from "../../../auth/permissions.js";
import type { Principal } from "../../../auth/principal.js";
import type { Graph } from "../../graph-engine/core/graph.js";
import { analyzeBlastRadius } from "../core/analyze.js";
import type { BlastRadiusOptions, BlastRadiusResult } from "../types.js";

/** Supplies the graph to analyze: live from the registries or, later, a pinned snapshot. */
export interface GraphLoader {
  load(principal: Principal, snapshotId?: string): Promise<Graph>;
}

export class BlastRadiusService {
  constructor(private readonly graphs: GraphLoader) {}

  async analyze(principal: Principal, input: { sourceNodeIds: string[]; snapshotId?: string | undefined } & BlastRadiusOptions): Promise<BlastRadiusResult> {
    assertCan(principal, "analysis:read");
    const graph = await this.graphs.load(principal, input.snapshotId);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructured only to omit
    const { sourceNodeIds, snapshotId: _s, ...options } = input;
    return analyzeBlastRadius(graph, sourceNodeIds, options);
  }
}
