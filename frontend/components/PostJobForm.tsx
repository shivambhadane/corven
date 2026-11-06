"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { parseEventLogs, parseUnits, type Hex } from "viem";
import { useAccount, useConfig } from "wagmi";
import { getBlock, writeContract } from "wagmi/actions";
import { APP_CHAIN } from "@/lib/chain";
import { useChainConfig, useModels } from "@/lib/api";
import { taskManagerAbi } from "@/lib/contracts";
import { fundTask, send } from "@/lib/fund";
import { revertReason } from "@/lib/format";
import { inputCommitment } from "@/lib/zk";

const STEPS = [
  "Store the job description",
  "Post the job on chain",
  "Approve the bounty",
  "Lock the bounty in escrow",
] as const;

// How long agents have to deliver. After the deadline no result is accepted and the funder can
// take the whole escrow back.
const DEADLINES = [
  { label: "1 hour", seconds: 3600 },
  { label: "1 day", seconds: 86_400 },
  { label: "1 week", seconds: 7 * 86_400 },
] as const;

const DEFAULT_MODEL = "local-demo";
const SAMPLE_INPUT = ["0.62", "1.4", "0.35"];

// A fixed default: a random one would differ between the server render and the browser.
const DEFAULT_TITLE = "Credit risk score — applicant #1042";

export function PostJobForm() {
  const router = useRouter();
  const wagmiConfig = useConfig();
  const { address, isConnected, chainId } = useAccount();
  const { data: chain } = useChainConfig();

  const [title, setTitle] = useState(DEFAULT_TITLE);
  const { data: models } = useModels();
  const [modelCid, setModelCid] = useState(DEFAULT_MODEL);
  const model = models?.find((m) => m.cid === modelCid);
  const [features, setFeatures] = useState(SAMPLE_INPUT);
  // Past this many numbers the input is one comma-separated list rather than a box per number.
  const MAX_FEATURE_BOXES = 12;
  const chooseModel = (cid: string) => {
    setModelCid(cid);
    const count = models?.find((m) => m.cid === cid)?.features ?? 3;
    setFeatures((current) => Array.from({ length: count }, (_, i) => current[i] ?? SAMPLE_INPUT[i % 3]));
  };
  const [bounty, setBounty] = useState("300");
  const [deadlineSeconds, setDeadlineSeconds] = useState<number>(86_400);
  const [proveOnChain, setProveOnChain] = useState(true);
  const [step, setStep] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set once the job exists on chain, so a failed deposit can point to it.
  const [posted, setPosted] = useState<Hex | null>(null);

  const ready = isConnected && chainId === APP_CHAIN.id && chain;
  // zkML: the execution service proves each run; committing to the input makes the chain check that proof.
  const zkModel = chain?.zk?.enabled ? chain.zk.models[modelCid] : undefined;
  const canProve = Boolean(zkModel?.verifier);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    const input = features.map((v) => (v.trim() === "" ? NaN : Number(v)));
    const expected = model?.features ?? features.length;
    if (!title.trim() || input.length !== expected || input.some((v) => !Number.isFinite(v)) || !(Number(bounty) > 0)) {
      setError(`Add a title, ${expected} numbers for the model input, and a bounty above 0.`);
      return;
    }
    if (!ready || !address) return;

    const amount = parseUnits(bounty, 18);
    setPosted(null);

    try {
      // 1. The description (title, model, input) goes to content-addressed storage; its SHA-256
      //    becomes the on-chain descriptionHash, so the input can't change after posting.
      setStep(0);
      const spec = JSON.stringify({ version: 1, title: title.trim(), model_cid: modelCid, input });
      const form = new FormData();
      form.append("file", new Blob([spec], { type: "application/json" }), "task.json");
      const stored = await fetch("/storage/upload", { method: "POST", body: form });
      if (!stored.ok) throw new Error("The storage service didn't accept the job description. Is it running?");
      const descriptionHash = `0x${(await stored.json()).content_hash}` as Hex;

      setStep(1);
      // Deadlines are judged by chain time, which can differ from this computer's clock.
      const deadline = (await getBlock(wagmiConfig)).timestamp + BigInt(deadlineSeconds);
      const created = await send(
        () =>
          canProve && proveOnChain && zkModel
            ? writeContract(wagmiConfig, {
                address: chain.contracts.TaskManager,
                abi: taskManagerAbi,
                functionName: "createTaskWithInput",
                args: [descriptionHash, deadline, amount, inputCommitment(modelCid, input, zkModel.input_scale), BigInt(input.length)],
              })
            : writeContract(wagmiConfig, {
                address: chain.contracts.TaskManager,
                abi: taskManagerAbi,
                functionName: "createTask",
                args: [descriptionHash, deadline, amount],
              }),
        wagmiConfig,
      );
      const taskId = parseEventLogs({ abi: taskManagerAbi, logs: created.logs, eventName: "TaskCreated" })[0].args.taskId;

      setPosted(taskId);
      await fundTask(wagmiConfig, chain, address, taskId, amount, (s) => setStep(s === "approve" ? 2 : 3));

      setStep(STEPS.length);
      router.push(`/tasks/${taskId}`);
    } catch (err) {
      setError(revertReason(err));
      setStep(null);
    }
  }

  const busy = step !== null && step < STEPS.length;

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Post a job</h2>
      </div>
      <form className="panel-body form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="job-title">Job title</label>
          <input id="job-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} disabled={busy} />
        </div>
        <div className="field">
          <label htmlFor="job-model">Model</label>
          <select id="job-model" value={modelCid} onChange={(e) => chooseModel(e.target.value)} disabled={busy}>
            {(models ?? [{ cid: DEFAULT_MODEL, model_id: "demo-model", version: "1.0.0", trained_by: "" }]).map((m) => (
              <option key={m.cid} value={m.cid}>
                {m.model_id} v{m.version}
              </option>
            ))}
          </select>
          {model && (
            <small>
              {model.trained_by} · sha256 {model.model_hash.slice(0, 12)}… · evidence:{" "}
              {model.zk_proofs ? "TEE attestation + zero-knowledge proof" : "TEE attestation (this model can't be zk-proven)"}
            </small>
          )}
        </div>
        <fieldset className="field">
          <legend>Model input — {features.length} features</legend>
          {features.length <= MAX_FEATURE_BOXES ? (
            <div className="features">
              {features.map((value, i) => (
                <input
                  key={i}
                  id={`feature-${i + 1}`}
                  aria-label={`Feature ${i + 1}`}
                  inputMode="decimal"
                  value={value}
                  disabled={busy}
                  onChange={(e) => setFeatures((f) => f.map((v, j) => (j === i ? e.target.value : v)))}
                />
              ))}
            </div>
          ) : (
            // Big inputs (e.g. an image's pixels) are pasted as one list instead of one box each.
            <textarea
              id="job-input"
              aria-label="Model input, comma-separated"
              rows={4}
              value={features.join(", ")}
              disabled={busy}
              onChange={(e) => setFeatures(e.target.value.split(/[\s,]+/).filter((v) => v !== ""))}
            />
          )}
          <small>The job&apos;s input is pinned on chain by the description hash; it can&apos;t change after posting.</small>
        </fieldset>
        <div className="field">
          <label htmlFor="job-bounty">Bounty (PBT)</label>
          <input id="job-bounty" inputMode="decimal" value={bounty} onChange={(e) => setBounty(e.target.value)} disabled={busy} />
          <small>
            The most you&apos;ll pay. The winning agent&apos;s price is paid out; you can reclaim the rest.
            Nova skips anything under 200 PBT.
          </small>
        </div>
        <div className="field">
          <label htmlFor="job-deadline">Deadline</label>
          <select
            id="job-deadline"
            value={deadlineSeconds}
            onChange={(e) => setDeadlineSeconds(Number(e.target.value))}
            disabled={busy}
          >
            {DEADLINES.map((d) => (
              <option key={d.seconds} value={d.seconds}>{d.label}</option>
            ))}
          </select>
          <small>No result by then? You can take the whole bounty back.</small>
        </div>
        {canProve && (
          <label className="check" htmlFor="job-prove">
            <input id="job-prove" type="checkbox" checked={proveOnChain} onChange={(e) => setProveOnChain(e.target.checked)} disabled={busy} />
            <span>
              Require a zero-knowledge proof checked on chain
              <small>The chain itself verifies the model ran on exactly this input before anyone is paid.</small>
            </span>
          </label>
        )}

        {step !== null && (
          <ol className="progress" aria-live="polite">
            {STEPS.map((label, i) => (
              <li key={label} className={i < step ? "done" : i === step ? "active" : ""}>
                {i < step ? "✓" : i === step ? "…" : "○"} {label}
              </li>
            ))}
          </ol>
        )}
        {error && (
          <p className="notice notice-bad" role="alert">
            {error}
            {posted && (
              <>
                {" "}The job is posted but not funded yet; <Link href={`/tasks/${posted}`}>fund it from its page</Link>.
              </>
            )}
          </p>
        )}
        {!ready && <p className="notice notice-info">Connect a wallet on {APP_CHAIN.name} to post a job.</p>}

        <button className="btn btn-primary" type="submit" disabled={!ready || busy} id="post-job">
          {busy ? "Posting…" : "Post & fund job"}
        </button>
      </form>
    </section>
  );
}
