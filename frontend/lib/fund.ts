import type { Address, Hex } from "viem";
import type { Config } from "wagmi";
import { readContract, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import type { ChainConfig } from "./api";
import { escrowAbi, tokenAbi } from "./contracts";

const messages = (error: unknown): string => {
  const parts: string[] = [];
  for (let e = error as { shortMessage?: string; message?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    parts.push(e.shortMessage ?? "", e.message ?? "");
  }
  return parts.join(" ");
};

/** The wallet signed with a transaction count the chain has already used: it hasn't seen the latest block. */
export const isStaleNonce = (error: unknown) => /nonce too low/i.test(messages(error));

/** Too low, or too high: a wallet that remembers transactions from before the local chain restarted. */
export const isWrongNonce = (error: unknown) => /nonce too (low|high)/i.test(messages(error));

/**
 * Send a transaction; if the wallet used a stale nonce, give it a moment to see the latest block and
 * ask once more. Nothing reached the chain the first time, so asking again can't pay twice.
 */
export async function send(write: () => Promise<Hex>, wagmiConfig: Config) {
  let hash: Hex;
  try {
    hash = await write();
  } catch (err) {
    if (!isStaleNonce(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, 3000));
    hash = await write();
  }
  return waitForTransactionReceipt(wagmiConfig, { hash });
}

/** Approve the escrow if needed, then lock `amount` for the job. */
export async function fundTask(
  wagmiConfig: Config,
  chain: ChainConfig,
  funder: Address,
  taskId: Hex,
  amount: bigint,
  onStep?: (step: "approve" | "deposit") => void,
) {
  onStep?.("approve");
  const allowance = await readContract(wagmiConfig, {
    address: chain.contracts.MockERC20,
    abi: tokenAbi,
    functionName: "allowance",
    args: [funder, chain.contracts.EscrowContract],
  });
  if (allowance < amount) {
    await send(
      () =>
        writeContract(wagmiConfig, {
          address: chain.contracts.MockERC20,
          abi: tokenAbi,
          functionName: "approve",
          args: [chain.contracts.EscrowContract, amount],
        }),
      wagmiConfig,
    );
  }

  onStep?.("deposit");
  await send(
    () =>
      writeContract(wagmiConfig, {
        address: chain.contracts.EscrowContract,
        abi: escrowAbi,
        functionName: "deposit",
        args: [taskId, amount],
      }),
    wagmiConfig,
  );
}
