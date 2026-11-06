import type { NormalizedObservation } from "../types.js";

/**
 * Deterministic, source-specific confidence. These are POLICY values describing
 * evidence strength, not calibrated probabilities. They are never averaged: the
 * registry keeps the strongest confidence among a dependency's evidence.
 * A high confidence grants nothing; every relationship still passes registry validation.
 */
export function confidenceFor(o: Pick<NormalizedObservation, "evidenceSourceType" | "outcome">): { confidence: number; rule: string } {
  switch (o.evidenceSourceType) {
    case "workflow_definition":
      return { confidence: 0.95, rule: "Explicit workflow declaration" };
    case "agent_configuration":
      return { confidence: 0.9, rule: "Explicit agent configuration" };
    case "runtime_event":
      return o.outcome === "allowed" || o.outcome === "completed"
        ? { confidence: 0.85, rule: "Successful gateway interaction" }
        : { confidence: 0.65, rule: "Attempted or denied gateway interaction" };
  }
}
