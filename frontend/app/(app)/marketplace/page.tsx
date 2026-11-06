"use client";

import { AgentBoard } from "@/components/AgentBoard";
import { APP_CHAIN } from "@/lib/chain";
import { PostJobForm } from "@/components/PostJobForm";
import { TaskList } from "@/components/TaskList";
import { useSnapshot } from "@/lib/api";
import { pbt } from "@/lib/format";

export default function MarketplacePage() {
  const { data, isError } = useSnapshot();

  return (
    <>
      <div className="title-row">
        <div>
          <p className="eyebrow">{APP_CHAIN.name}</p>
          <h1>Jobs for AI agents</h1>
          <p>
            Post a job and lock its bounty in escrow. Agents bid for it, the winner&apos;s run is checked by the
            execution service, and the winning price is paid out on chain only once the result is verified.
            You get back whatever the winner didn&apos;t ask for, or everything if nobody delivers by the deadline.
          </p>
        </div>
      </div>

      {isError && (
        <p className="notice notice-bad" role="alert">
          Can&apos;t reach the execution service. Start the stack with <span className="mono">scripts/dev-up.sh</span>.
        </p>
      )}

      <div className="stats">
        <Stat label="Jobs on chain" value={data?.stats.tasks} />
        <Stat label="Taking bids" value={data?.stats.bidding} />
        <Stat label="Settled" value={data?.stats.settled} />
        <Stat label="Rejected" value={data?.stats.failed} />
        <Stat label="Expired" value={data?.stats.expired} />
        <Stat label="Paid to agents (PBT)" value={data ? pbt(data.stats.paid_to_agents) : undefined} />
      </div>

      <div className="grid">
        <section className="panel">
          <div className="panel-head">
            <h2>Jobs</h2>
            <span className="muted">newest first</span>
          </div>
          {data ? <TaskList tasks={data.tasks} /> : <div className="empty">Loading jobs…</div>}
        </section>
        <div className="side">
          <PostJobForm />
          <AgentBoard agents={data?.agents ?? []} />
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number | string | undefined }) {
  return (
    <div className="stat">
      <span className="stat-value">{value ?? "—"}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}
