import { formatUnits } from "viem";
import { isWrongNonce } from "./fund";

export const short = (value?: string | null, head = 6, tail = 4) =>
  !value ? "—" : value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;

export const pbt = (wei: string | bigint, digits = 2) =>
  Number(formatUnits(typeof wei === "bigint" ? wei : BigInt(wei), 18)).toLocaleString("en-US", {
    maximumFractionDigits: digits,
  });

export const STAGE_LABEL: Record<string, string> = {
  awaiting_funding: "Awaiting funding",
  bidding: "Agents bidding",
  executing: "Running",
  verified: "Verified",
  result_on_chain: "Result on chain",
  settled: "Settled",
  expired: "Expired",
  failed: "Rejected",
};

export const STAGE_TONE: Record<string, "ok" | "warn" | "bad" | "info" | ""> = {
  awaiting_funding: "",
  bidding: "info",
  executing: "info",
  verified: "info",
  result_on_chain: "warn",
  settled: "ok",
  expired: "warn",
  failed: "bad",
};

export function revertReason(error: unknown): string {
  // MetaMask numbers each account's transactions itself (the nonce). After the local chain restarts
  // it still remembers the old chain's, and the new chain refuses the numbers it picks.
  if (isWrongNonce(error)) {
    return (
      "Your wallet's transaction count (nonce) doesn't match the chain, so the chain refused the " +
      "transaction. In MetaMask open Settings → Advanced → Clear activity tab data, then try again. " +
      "This happens after the local chain restarts."
    );
  }
  const e = error as { shortMessage?: string; message?: string; cause?: { data?: { errorName?: string } } };
  const name = e?.cause?.data?.errorName;
  if (name) return `The contract refused: ${name}`;
  if (e?.shortMessage) return e.shortMessage;
  return e?.message?.split("\n")[0] ?? "Something went wrong";
}
