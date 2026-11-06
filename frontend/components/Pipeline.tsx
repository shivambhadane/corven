import type { TaskView } from "@/lib/api";
import { pbt } from "@/lib/format";

type State = "done" | "active" | "failed" | "pending";
interface Step { label: string; note: string; state: State }

/** The job's path from posting to payout, derived from what the chain and the execution service report. */
export function pipelineSteps(task: TaskView): Step[] {
  const funded = task.status !== "Open";
  const winner = task.auction.winner;
  const failed = task.stage === "failed";
  const verified = task.verification?.verification_result === true;
  const onChain = Boolean(task.result);
  const settled = Boolean(task.settlement);
  const closesIn = task.auction.closes_in;
  const claimed = task.refunds.reduce((sum, r) => sum + BigInt(r.amount), 0n);

  if (task.stage === "expired") {
    const pool = BigInt(task.funded);
    return [
      { label: "Job posted", note: "Description hash recorded on chain", state: "done" },
      { label: "Bounty locked in escrow", note: `${pbt(task.funded)} of ${pbt(task.bounty)} PBT`, state: funded ? "done" : "failed" },
      { label: "Deadline passed", note: "No verified result in time, so no agent can be paid", state: "failed" },
      {
        label: "Escrow returned to the funders",
        note: `${pbt(claimed)} of ${pbt(pool)} PBT claimed`,
        state: pool > 0n && claimed >= pool ? "done" : "active",
      },
    ];
  }

  const leftover = task.settlement ? BigInt(task.settlement.refund_amount) : null;
  const steps: Step[] = [
    { label: "Job posted", note: "Description hash recorded on chain", state: "done" },
    {
      label: "Bounty locked in escrow",
      note: `${pbt(task.funded)} of ${pbt(task.bounty)} PBT`,
      state: funded ? "done" : "active",
    },
    {
      label: "Agents bid",
      note: winner
        ? `${winner.agent_name} won at ${pbt(winner.amount)} PBT (the most it can be paid)`
        : funded
          ? closesIn != null
            ? `${task.auction.bids.length} bid(s) · closes in ${Math.ceil(closesIn)}s`
            : "Waiting for the first bid"
          : "Opens once the bounty is locked",
      state: winner ? "done" : funded ? "active" : "pending",
    },
    {
      label: "Integrity checks & run",
      note: failed
        ? task.error ?? "Rejected"
        : task.receipt
          ? task.zk_verification?.verified
            ? "Signature, model and input hashes match; zk proof generated"
            : "Agent signature, model hash and input hash all match"
          : winner
            ? "Checking the winner's payload and running the model"
            : "Agent signature · model hash · input bound to the job",
      state: failed ? "failed" : task.receipt ? "done" : winner ? "active" : "pending",
    },
    {
      label: "Receipt verified",
      note: task.verification
        ? verified
          ? "Attestation and hashes check out"
          : `Failed: ${task.verification.reason_code}`
        : "Signed receipt checked by /verify",
      state: task.verification ? (verified ? "done" : "failed") : task.receipt ? "active" : "pending",
    },
    {
      label: "Result on chain",
      note: task.result?.proven_on_chain
        ? "zk proof checked by the verifier contract, then accepted"
        : onChain
          ? "submitResult by the executor wallet"
          : task.input_committed
            ? "Only a zk proof about this exact input will be accepted"
            : "Submitted by the executor wallet",
      state: onChain ? "done" : verified ? "active" : "pending",
    },
    {
      label: "Settled",
      note: settled ? "The winning price split 81% agent · 9% stakers · 10% treasury" : "Anyone can call settle()",
      state: settled ? "done" : onChain ? "active" : "pending",
    },
  ];
  if (leftover !== null && leftover > 0n) {
    steps.push({
      label: "Leftover returned to the funders",
      note: `${pbt(claimed)} of ${pbt(leftover)} PBT claimed`,
      state: claimed >= leftover ? "done" : "active",
    });
  }
  return steps;
}

const ICON: Record<State, string> = { done: "✓", active: "•", failed: "!", pending: "" };

export function Pipeline({ task }: { task: TaskView }) {
  return (
    <ol className="steps" data-testid="pipeline">
      {pipelineSteps(task).map((step, i) => (
        <li key={step.label} className={`step step-${step.state}`}>
          <span className="step-icon" aria-hidden="true">{ICON[step.state] || i + 1}</span>
          <div>
            <div className="step-label">{step.label}</div>
            <div className="step-note">{step.note}</div>
          </div>
        </li>
      ))}
    </ol>
  );
}
