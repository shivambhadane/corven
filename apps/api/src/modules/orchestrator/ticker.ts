import { PgBoss } from "pg-boss";
import type { Orchestrator } from "./service.js";

export const ORCHESTRATOR_QUEUE = "orchestrator.tick";

/**
 * Drives the orchestrator from pg-boss (the PostgreSQL queue already used by discovery): a
 * recurring schedule plus a nudge when a workflow starts. pg-boss only says "run now"; all
 * state lives in `incident_workflows`, so a lost or duplicated tick is harmless.
 */
export class PgBossTicker {
  private readonly boss: PgBoss;
  constructor(connectionString: string, private readonly orchestrator: Orchestrator, onError: (e: Error) => void = () => undefined) {
    this.boss = new PgBoss(connectionString);
    this.boss.on("error", (e: Error) => onError(e));
  }
  async start(): Promise<void> {
    await this.boss.start();
    await this.boss.createQueue(ORCHESTRATOR_QUEUE);
    await this.boss.schedule(ORCHESTRATOR_QUEUE, "* * * * *", {});
    await this.boss.work(ORCHESTRATOR_QUEUE, { pollingIntervalSeconds: 5 }, async () => {
      await this.orchestrator.maintenance();
      await this.orchestrator.tick();
    });
  }
  nudge(): Promise<unknown> {
    return this.boss.send(ORCHESTRATOR_QUEUE, {}, { singletonSeconds: 5 });
  }
  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 10_000 });
  }
}
