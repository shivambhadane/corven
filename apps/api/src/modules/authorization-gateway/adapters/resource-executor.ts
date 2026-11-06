/**
 * The resource side of a protected operation. CORVEN authorizes and records;
 * what actually happens on the resource is an executor. Executors that pass the
 * authorization on (`authorization`) let a resource that supports conditional
 * execution re-verify atomically and close the check-to-use window.
 */
export interface ExecutionContext {
  organizationId: string;
  agentId: string;
  resourceId: string;
  action: string;
  payload: unknown;
  requestId: string;
  authorization: { decisionId: string; permissionId: string | null; permissionVersion: number | null };
}

export interface ExecutorOutcome {
  status: "executed" | "submitted";
  externalReference?: string;
  result?: Record<string, unknown>;
}

export interface ResourceExecutor {
  readonly name: string;
  /** True for executors that do not touch a real system. Reported on every execution record. */
  readonly simulated: boolean;
  execute(ctx: ExecutionContext): Promise<ExecutorOutcome>;
}

export class ResourceExecutors {
  private readonly byResource = new Map<string, ResourceExecutor>();
  register(resourceId: string, executor: ResourceExecutor): void {
    this.byResource.set(resourceId, executor);
  }
  get(resourceId: string): ResourceExecutor | undefined {
    return this.byResource.get(resourceId);
  }
}

/** For tests and local development only: records nothing outside CORVEN and says so in every result. */
export class SimulatedExecutor implements ResourceExecutor {
  readonly name = "simulated";
  readonly simulated = true;
  readonly calls: ExecutionContext[] = [];
  async execute(ctx: ExecutionContext): Promise<ExecutorOutcome> {
    this.calls.push(ctx);
    return { status: "executed", result: { simulated: true, echoedAction: ctx.action } };
  }
}
