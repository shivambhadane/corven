import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, defineChain, http, isAddress, parseEther, parseUnits } from "viem";
import { tokenAbi } from "@/lib/contracts";

// Local chain only. Hardhat account #0 deployed the token (only it can mint) and is unlocked on
// the local node, so the node signs these transactions; no private key lives in this app.
const DEPLOYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const EXECUTION_URL = process.env.EXECUTION_URL || "http://127.0.0.1:8000";
// Defined here rather than imported from viem/chains, which would pull every chain into the server bundle.
const hardhat = defineChain({
  id: 31337,
  name: "Hardhat",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
});

export async function POST(request: Request) {
  const { address } = (await request.json().catch(() => ({}))) as { address?: string };
  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "Send a valid wallet address" }, { status: 400 });
  }

  const config = await fetch(`${EXECUTION_URL}/api/chain/config`, { cache: "no-store" }).then((r) => r.json());
  if (config.chain_id !== hardhat.id) {
    return NextResponse.json({ error: "The faucet only exists on the local Hardhat chain" }, { status: 403 });
  }

  const publicClient = createPublicClient({ chain: hardhat, transport: http(RPC_URL) });
  const wallet = createWalletClient({ chain: hardhat, transport: http(RPC_URL) });

  const mintHash = await wallet.writeContract({
    account: DEPLOYER,
    address: config.contracts.MockERC20,
    abi: tokenAbi,
    functionName: "mint",
    args: [address, parseUnits("1000", 18)],
  });
  await publicClient.waitForTransactionReceipt({ hash: mintHash });

  // A fresh MetaMask account has no ETH on the local chain, and every transaction needs gas.
  if ((await publicClient.getBalance({ address })) < parseEther("1")) {
    const gasHash = await wallet.sendTransaction({ account: DEPLOYER, to: address, value: parseEther("10") });
    await publicClient.waitForTransactionReceipt({ hash: gasHash });
  }
  return NextResponse.json({ minted: "1000", tx_hash: mintHash });
}
