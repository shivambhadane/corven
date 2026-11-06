import { PgBoss } from "pg-boss";

export interface DiscoveryJob {
  runId: string;
  organizationId: string;
}

export type JobHandler = (job: DiscoveryJob, ctx: { retryCount: number }) => Promise<void>;

/**
 * Background execution boundary. A run is created and persisted FIRST, and only
 * then queued, so the request never waits for discovery and a lost job leaves a
 * visible `pending` run rather than nothing.
 */
export interface JobQueue {
  enqueue(job: DiscoveryJob): Promise<void>;
  start(handler: JobHandler): Promise<void>;
  stop(): Promise<void>;
}

/** In-process queue for tests and local use: runs the handler in the background and lets callers wait for it. */
export class InlineJobQueue implements JobQueue {
  private handler: JobHandler | null = null;
  private readonly inflight = new Set<Promise<void>>();
  readonly errors: unknown[] = [];

  constructor(private readonly options: { autoRun?: boolean } = { autoRun: true }) {}

  async start(handler: JobHandler): Promise<void> {
    this.handler = handler;
  }

  async enqueue(job: DiscoveryJob): Promise<void> {
    if (!this.options.autoRun || !this.handler) return;
    const p = new Promise<void>((resolve) => setImmediate(resolve))
      .then(() => this.handler!(job, { retryCount: 0 }))
      .catch((e) => void this.errors.push(e))
      .finally(() => void this.inflight.delete(p));
    this.inflight.add(p);
  }

  /** Resolves when every queued job has finished. */
  async idle(): Promise<void> {
    while (this.inflight.size > 0) await Promise.all([...this.inflight]);
  }

  async stop(): Promise<void> {
    await this.idle();
  }
}

export const DISCOVERY_QUEUE_NAME = "discovery.run";

/** pg-boss over the same PostgreSQL. Retries transient failures with backoff. */
export class PgBossJobQueue implements JobQueue {
  private readonly boss: PgBoss;

  constructor(connectionString: string, private readonly onError: (e: Error) => void = () => undefined) {
    this.boss = new PgBoss(connectionString);
    this.boss.on("error", (e: Error) => this.onError(e));
  }

  async start(handler: JobHandler): Promise<void> {
    await this.boss.start();
    await this.boss.createQueue(DISCOVERY_QUEUE_NAME);
    await this.boss.work<DiscoveryJob>(DISCOVERY_QUEUE_NAME, { pollingIntervalSeconds: 0.5 }, async (jobs) => {
      for (const j of jobs) await handler(j.data, { retryCount: j.retryCount });
    });
  }

  async enqueue(job: DiscoveryJob): Promise<void> {
    await this.boss.send(DISCOVERY_QUEUE_NAME, job, { retryLimit: 3, retryDelay: 2, retryBackoff: true });
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 10_000 });
  }
}
