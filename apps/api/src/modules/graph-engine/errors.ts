import { AppError } from "../../errors.js";

/**
 * Structured graph errors. A query that simply finds nothing (no path, not
 * reachable) is a normal result, never an error; PATH_NOT_FOUND exists for
 * callers that need to require a path.
 */
export type GraphErrorCode =
  | "NODE_NOT_FOUND"
  | "INVALID_NODE"
  | "INVALID_EDGE"
  | "INVALID_GRAPH"
  | "CROSS_TENANT_REFERENCE"
  | "PATH_NOT_FOUND"
  | "MAX_DEPTH_EXCEEDED"
  | "MAX_PATHS_EXCEEDED"
  | "GRAPH_BUILD_FAILED"
  | "INVALID_FILTER";

const STATUS: Record<GraphErrorCode, number> = {
  NODE_NOT_FOUND: 404,
  PATH_NOT_FOUND: 404,
  INVALID_NODE: 422,
  INVALID_EDGE: 422,
  INVALID_FILTER: 400,
  MAX_DEPTH_EXCEEDED: 400,
  MAX_PATHS_EXCEEDED: 400,
  INVALID_GRAPH: 500,
  CROSS_TENANT_REFERENCE: 500,
  GRAPH_BUILD_FAILED: 500,
};

export class GraphError extends AppError {
  constructor(
    public readonly graphCode: GraphErrorCode,
    message: string,
    details?: unknown,
  ) {
    super(STATUS[graphCode], graphCode, message, details);
  }
}
