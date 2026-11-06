"use client";

import { useQuery } from "@tanstack/react-query";
import type { Address, Hex } from "viem";

export type Stage =
  | "awaiting_funding"
  | "bidding"
  | "executing"
  | "verified"
  | "result_on_chain"
  | "settled"
  | "expired"
  | "failed";

export interface Bid {
  agent: Address;
  agent_name: string;
  amount: string;
  at: number;
}

export interface Receipt {
  execution_id: string;
  model_id: string;
  model_cid: string;
  model_version: string;
  model_hash: string;
  input_hash: string;
  output_hash: string;
  result: unknown;
  attestation: { signer_identity: string; enclave_measurement: string; hardware_signature: string; timestamp: number } | null;
}

export interface TaskView {
  task_id: Hex;
  title: string | null;
  creator: Address;
  description_hash: Hex;
  spec: { title: string; model_cid: string; input: number[] } | null;
  spec_error: string | null;
  deadline: number;
  deadline_passed: boolean;
  input_committed: boolean;
  bounty: string;
  funded: string;
  status: "Open" | "InProgress" | "Completed" | "Settled" | "Expired";
  stage: Stage;
  auction: { bids: Bid[]; closes_in: number | null; winner: { agent: Address; agent_name: string; amount: string } | null };
  error: string | null;
  receipt: Receipt | null;
  verification: { verification_result: boolean; reason_code: string | null } | null;
  result: { tx_hash: Hex; worker: Address; price: string; proven_on_chain?: boolean } | null;
  zk_verification: {
    verified: boolean;
    reason_code: string | null;
    proof_system: string;
    verification_key_hash: string;
    public_output: number[];
  } | null;
  settlement: {
    tx_hash: Hex;
    worker: Address;
    worker_amount: string;
    staker_amount: string;
    treasury_amount: string;
    refund_amount: string;
  } | null;
  refunds: { tx_hash: Hex; funder: Address; amount: string }[];
  refund_open: boolean;
}

export interface AgentView {
  address: Address;
  name: string;
  bids: number;
  wins: number;
  completed: number;
  earned: string;
}

export interface Snapshot {
  tasks: TaskView[];
  agents: AgentView[];
  stats: { tasks: number; bidding: number; settled: number; failed: number; expired: number; paid_to_agents: string };
}

export interface ChainConfig {
  chain_id: number;
  contracts: { TaskManager: Address; EscrowContract: Address; SettlementContract: Address; MockERC20: Address };
  executor: Address;
  treasury: Address;
  auction_window_seconds: number;
  zk?: { enabled: boolean; models: Record<string, { input_scale: number; verifier: Address | null }> };
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export interface ModelInfo {
  model_id: string;
  version: string;
  cid: string;
  model_hash: string;
  features: number;
  trained_by: string;
  zk_proofs: boolean;
}

export const useModels = () =>
  useQuery({ queryKey: ["models"], queryFn: () => getJson<ModelInfo[]>("/exec/api/models"), staleTime: 60_000 });

export const useChainConfig = () =>
  useQuery({ queryKey: ["config"], queryFn: () => getJson<ChainConfig>("/exec/api/chain/config"), staleTime: Infinity, retry: 2 });

export const useSnapshot = () =>
  useQuery({ queryKey: ["snapshot"], queryFn: () => getJson<Snapshot>("/exec/api/chain/tasks"), refetchInterval: 1500 });

export const useTask = (taskId: string) =>
  useQuery({
    queryKey: ["task", taskId],
    queryFn: () => getJson<TaskView>(`/exec/api/chain/tasks/${taskId}`),
    refetchInterval: 1000,
    retry: (count) => count < 30, // a just-posted task appears once the execution service reads its event
    retryDelay: 1000,
  });
