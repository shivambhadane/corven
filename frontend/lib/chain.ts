import { defineChain } from "viem";
import { hardhat, sepolia } from "wagmi/chains";

/** 0G's public testnet: gas in 0G (faucet.0g.ai). */
export const galileo = defineChain({
  id: 16602,
  name: "0G Galileo Testnet",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: ["https://evmrpc-testnet.0g.ai"] } },
  blockExplorers: { default: { name: "0G Chainscan", url: "https://chainscan-galileo.0g.ai" } },
  testnet: true,
});

// Which chain the website talks to: local Hardhat by default, or NEXT_PUBLIC_CHAIN=galileo / sepolia
// (optionally with NEXT_PUBLIC_RPC_URL). The execution service and agents must use the same chain.
const CHAINS = { galileo, sepolia, hardhat } as const;
export const APP_CHAIN = CHAINS[(process.env.NEXT_PUBLIC_CHAIN as keyof typeof CHAINS) ?? "hardhat"] ?? hardhat;
export const IS_LOCAL_CHAIN = APP_CHAIN.id === hardhat.id;
export const RPC_URL =
  process.env.NEXT_PUBLIC_RPC_URL || (IS_LOCAL_CHAIN ? "http://127.0.0.1:8545" : APP_CHAIN.rpcUrls.default.http[0]);
