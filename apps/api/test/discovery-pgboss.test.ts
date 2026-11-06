import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { PgBossJobQueue } from "../src/modules/dependency-discovery/jobs/queue.js";

let queue: PgBossJobQueue;
const errors: Error[] = [];
beforeAll(() => {
  queue = new PgBossJobQueue(inject("dbUrl"), (e) => errors.push(e));
});
afterAll(() => queue.stop());

describe("pg-boss job queue", () => {
  it("delivers an enqueued job to the handler, and retries a failing one", async () => {
    const seen: Array<{ runId: string; retry: number }> = [];
    let failedOnce = false;
    await queue.start(async (job, ctx) => {
      seen.push({ runId: job.runId, retry: ctx.retryCount });
      if (job.runId === "flaky" && !failedOnce) {
        failedOnce = true;
        throw new Error("transient");
      }
    });
    await queue.enqueue({ runId: "ok", organizationId: "o" });
    await queue.enqueue({ runId: "flaky", organizationId: "o" });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline && !(seen.some((s) => s.runId === "ok") && seen.filter((s) => s.runId === "flaky").length >= 2)) {
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(seen.filter((s) => s.runId === "ok")).toHaveLength(1);
    const flaky = seen.filter((s) => s.runId === "flaky");
    expect(flaky.length).toBeGreaterThanOrEqual(2);
    expect(flaky[1]?.retry).toBeGreaterThanOrEqual(1);
  }, 40_000);
});
