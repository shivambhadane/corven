"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import type { Hex } from "viem";
import { useAccount, useConfig, useReadContract } from "wagmi";
import { waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { APP_CHAIN } from "@/lib/chain";
import { Pipeline } from "@/components/Pipeline";
import { StageBadge } from "@/components/StageBadge";
import { useChainConfig, useTask, type TaskView } from "@/lib/api";
import { escrowAbi, settlementAbi } from "@/lib/contracts";
import { fundTask } from "@/lib/fund";
import { pbt, revertReason, short } from "@/lib/format";

export default function TaskPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const { data: task, isError, isLoading } = useTask(taskId);

  if (!task) {
    return (
      <>
        <Link href="/marketplace" className="muted">← All jobs</Link>
        <div className="panel">
          <div className="empty">
            {isLoading ? "Waiting for the execution service to read this job from the chain…" : isError ? `No job with this id on ${APP_CHAIN.name}.` : null}
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Link href="/marketplace" className="muted">← All jobs</Link>
      <div className="title-row">
        <div>
          <p className="eyebrow mono">{short(task.task_id, 10, 8)}</p>
          <h1>{task.title ?? "Untitled job"}</h1>
          <p>
            Bounty <strong>{pbt(task.bounty)} PBT</strong> · posted by <span className="mono">{short(task.creator)}</span>
          </p>
        </div>
        <span data-testid="stage"><StageBadge stage={task.stage} /></span>
      </div>

      {task.spec_error && <p className="notice notice-bad">The job description failed its check: {task.spec_error}</p>}

      <div className="detail-grid">
        <section className="panel">
          <div className="panel-head"><h2>Progress</h2></div>
          <div className="panel-body"><Pipeline task={task} /></div>
        </section>

        <div className="side">
          {task.status === "Open" && <Funding task={task} />}
          <Bids task={task} />
          <Execution task={task} />
          <Payout task={task} />
        </div>
      </div>
    </>
  );
}

/** A job posted but not (fully) funded — e.g. its deposit failed — can be funded here by anyone. */
function Funding({ task }: { task: TaskView }) {
  const wagmiConfig = useConfig();
  const { address, isConnected, chainId } = useAccount();
  const { data: chain } = useChainConfig();
  const [state, setState] = useState<{ busy: "approve" | "deposit" | null; error: string | null }>({ busy: null, error: null });
  const missing = BigInt(task.bounty) - BigInt(task.funded);
  const onLocalChain = isConnected && chainId === APP_CHAIN.id;

  async function fund() {
    if (!chain || !address || missing <= 0n) return;
    setState({ busy: "approve", error: null });
    try {
      await fundTask(wagmiConfig, chain, address, task.task_id, missing, (step) => setState({ busy: step, error: null }));
      setState({ busy: null, error: null });
    } catch (err) {
      setState({ busy: null, error: revertReason(err) });
    }
  }

  return (
    <section className="panel" data-testid="funding">
      <div className="panel-head"><h2>Funding</h2></div>
      <div className="panel-body form">
        {state.error && <p className="notice notice-bad" role="alert">{state.error}</p>}
        {task.deadline_passed ? (
          <p className="step-note">The deadline passed before the bounty was locked, so this job can&apos;t be funded any more.</p>
        ) : (
          <>
            <p className="step-note">
              {pbt(task.funded)} of {pbt(task.bounty)} PBT locked. Agents start bidding once the whole bounty is in escrow.
            </p>
            <button className="btn btn-primary" onClick={fund} disabled={state.busy !== null || !onLocalChain || missing <= 0n} id="fund-job">
              {state.busy === "approve" ? "Approving…" : state.busy === "deposit" ? "Locking…" : `Fund this job (${pbt(missing)} PBT)`}
            </button>
            {!onLocalChain && <p className="step-note">Connect a wallet on {APP_CHAIN.name} to fund it.</p>}
          </>
        )}
      </div>
    </section>
  );
}

function Bids({ task }: { task: TaskView }) {
  const winner = task.auction.winner;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Bids</h2>
        <span className="muted">lowest price wins</span>
      </div>
      {task.auction.bids.length === 0 ? (
        <div className="empty">
          {task.stage === "expired"
            ? "No agent bid before the deadline."
            : task.status === "Open"
              ? "Bidding opens once the bounty is locked."
              : "No bids yet."}
        </div>
      ) : (
        <div className="table-wrap">
          <table data-testid="bids">
            <thead><tr><th>Agent</th><th>Wallet</th><th className="num">Price (PBT)</th></tr></thead>
            <tbody>
              {task.auction.bids.map((bid) => {
                const won = winner?.agent.toLowerCase() === bid.agent.toLowerCase();
                return (
                  <tr key={bid.agent} className={won ? "winner" : ""}>
                    <td>{bid.agent_name}{won && " — winner"}</td>
                    <td className="mono">{short(bid.agent)}</td>
                    <td className="num mono">{pbt(bid.amount)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Execution({ task }: { task: TaskView }) {
  const r = task.receipt;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Execution</h2>
        {task.verification && (
          <span className={`pill ${task.verification.verification_result ? "pill-ok" : "pill-bad"}`}>
            {task.verification.verification_result ? "Verified" : "Not verified"}
          </span>
        )}
      </div>
      <div className="panel-body">
        {task.error && <p className="notice notice-bad">{task.error}</p>}
        <dl className="kv">
          <dt>Model input</dt>
          <dd>{task.spec ? JSON.stringify(task.spec.input) : "—"}</dd>
          <dt>Description hash</dt>
          <dd>{task.description_hash}</dd>
          {r && (
            <>
              <dt>Result</dt>
              <dd data-testid="result">{JSON.stringify(r.result)}</dd>
              <dt>Model</dt>
              <dd>{r.model_id} v{r.model_version}</dd>
              <dt>Model hash</dt>
              <dd>{r.model_hash}</dd>
              <dt>Input hash</dt>
              <dd>{r.input_hash}</dd>
              <dt>Output hash</dt>
              <dd>{r.output_hash}</dd>
              {r.attestation && (
                <>
                  <dt>Attested by</dt>
                  <dd>{r.attestation.signer_identity}</dd>
                </>
              )}
              {task.zk_verification && (
                <>
                  <dt>zk proof</dt>
                  <dd data-testid="zk-proof">
                    {task.zk_verification.verified ? "Verified" : `Failed: ${task.zk_verification.reason_code}`} ·{" "}
                    {task.zk_verification.proof_system} · output {task.zk_verification.public_output.map((v) => v.toFixed(4)).join(", ")}
                  </dd>
                  <dt>Verification key</dt>
                  <dd>{task.zk_verification.verification_key_hash}</dd>
                </>
              )}
              {task.result?.proven_on_chain && (
                <>
                  <dt>On chain</dt>
                  <dd data-testid="proven-on-chain">Proof checked by the verifier contract before the result was accepted</dd>
                </>
              )}
            </>
          )}
        </dl>
      </div>
    </section>
  );
}

function Payout({ task }: { task: TaskView }) {
  const wagmiConfig = useConfig();
  const { address, isConnected, chainId } = useAccount();
  const { data: chain } = useChainConfig();
  const [state, setState] = useState<{ busy: string | null; error: string | null }>({ busy: null, error: null });
  const s = task.settlement;
  const share = (amount: string) =>
    s ? `${Math.round((Number(BigInt(amount) * 1000n / (BigInt(s.worker_amount) + BigInt(s.staker_amount) + BigInt(s.treasury_amount)))) / 10)}%` : "";

  // What the connected wallet could reclaim right now (0 unless it funded this job).
  const { data: refundable, refetch } = useReadContract({
    address: chain?.contracts.EscrowContract,
    abi: escrowAbi,
    functionName: "refundableAmount",
    args: address ? [task.task_id as Hex, address] : undefined,
    query: { enabled: Boolean(chain && address && task.refund_open), refetchInterval: 2000 },
  });
  const onLocalChain = isConnected && chainId === APP_CHAIN.id;

  async function run(kind: "settle" | "refund") {
    if (!chain) return;
    setState({ busy: kind, error: null });
    try {
      const hash =
        kind === "settle"
          ? await writeContract(wagmiConfig, {
              address: chain.contracts.SettlementContract,
              abi: settlementAbi,
              functionName: "settle",
              args: [task.task_id as Hex],
            })
          : await writeContract(wagmiConfig, {
              address: chain.contracts.EscrowContract,
              abi: escrowAbi,
              functionName: "claimRefund",
              args: [task.task_id as Hex],
            });
      await waitForTransactionReceipt(wagmiConfig, { hash });
      setState({ busy: null, error: null });
      refetch();
    } catch (err) {
      setState({ busy: null, error: revertReason(err) });
    }
  }

  const claimed = task.refunds.reduce((sum, r) => sum + BigInt(r.amount), 0n);
  const refunds = task.refund_open ? (
    <div className="refund" data-testid="refund">
      <h3 className="section-title">Back to the funders</h3>
      <dl className="kv">
        <dt>Refundable</dt>
        <dd>{pbt(s ? s.refund_amount : task.funded)} PBT</dd>
        <dt>Claimed so far</dt>
        <dd>{pbt(claimed)} PBT</dd>
      </dl>
      {refundable !== undefined && refundable > 0n && (
        <button className="btn btn-primary" onClick={() => run("refund")} disabled={state.busy !== null || !onLocalChain} id="claim-refund">
          {state.busy === "refund" ? "Claiming…" : `Claim your ${pbt(refundable)} PBT`}
        </button>
      )}
      {refundable === 0n && <p className="step-note">Nothing left for this wallet to claim.</p>}
    </div>
  ) : null;

  return (
    <section className="panel">
      <div className="panel-head"><h2>Payout</h2></div>
      <div className="panel-body">
        {state.error && <p className="notice notice-bad">{state.error}</p>}
        {s ? (
          <>
            <p className="step-note" data-testid="price">
              Winning price <strong>{pbt(task.result?.price ?? "0")} PBT</strong> of a {pbt(task.bounty)} PBT bounty, split 81 / 9 / 10:
            </p>
            <div className="split" data-testid="payout">
              <div><strong>{pbt(s.worker_amount)}</strong><span>Agent ({share(s.worker_amount)})</span></div>
              <div><strong>{pbt(s.staker_amount)}</strong><span>{BigInt(s.staker_amount) === 0n ? "Stakers (none staking)" : `Stakers (${share(s.staker_amount)})`}</span></div>
              <div><strong>{pbt(s.treasury_amount)}</strong><span>Treasury ({share(s.treasury_amount)})</span></div>
            </div>
            {BigInt(s.staker_amount) === 0n && (
              <p className="step-note">Nobody was staking, so the stakers&apos; 9% went to the treasury.</p>
            )}
            <dl className="kv" style={{ marginTop: 14 }}>
              <dt>Paid to</dt><dd>{s.worker}</dd>
              {task.result && (<><dt>Result tx</dt><dd>{task.result.tx_hash}</dd></>)}
              <dt>Settle tx</dt><dd>{s.tx_hash}</dd>
            </dl>
            {refunds}
          </>
        ) : task.result ? (
          <>
            <dl className="kv">
              <dt>Worker</dt><dd>{task.result.worker}</dd>
              <dt>Price</dt><dd>{pbt(task.result.price)} PBT</dd>
              <dt>Result tx</dt><dd>{task.result.tx_hash}</dd>
            </dl>
            <p className="step-note">The winning agent settles its own job. Anyone can settle it; the money still goes to the worker.</p>
            <button className="btn" onClick={() => run("settle")} disabled={state.busy !== null || !onLocalChain}>
              {state.busy === "settle" ? "Settling…" : "Settle now"}
            </button>
          </>
        ) : task.stage === "expired" ? (
          <>
            <p className="notice notice-info">
              The deadline passed with no result, so no agent can be paid. Whoever funded the job can take it all back.
            </p>
            {refunds}
          </>
        ) : (
          <div className="empty">
            The bounty stays in escrow until a verified result is on chain, or until the deadline passes with none.
          </div>
        )}
      </div>
    </section>
  );
}
