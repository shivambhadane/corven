"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useReadContract, useSwitchChain } from "wagmi";
import { APP_CHAIN, IS_LOCAL_CHAIN } from "@/lib/chain";
import { useChainConfig } from "@/lib/api";
import { tokenAbi } from "@/lib/contracts";
import { pbt, short } from "@/lib/format";

export function WalletPanel() {
  const { address, chainId, isConnected, connector } = useAccount();
  const { connectors, connect, isPending, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const { data: config } = useChainConfig();
  const [faucet, setFaucet] = useState<"idle" | "busy" | "error">("idle");

  const { data: balance, refetch } = useReadContract({
    address: config?.contracts.MockERC20,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(address && config), refetchInterval: 3000 },
  });

  if (!isConnected) {
    const injected = connectors.find((c) => c.type === "injected");
    const testAccount = connectors.find((c) => c.type === "mock");
    return (
      <div className="wallet">
        {injected && (
          <button className="btn btn-small" onClick={() => connect({ connector: injected })} disabled={isPending}>
            Connect MetaMask
          </button>
        )}
        {connectError && (
          <span className="pill pill-bad" role="alert">
            {(connectError.name as string) === "ProviderNotFoundError" ? "MetaMask not found" : connectError.message.split("\n")[0]}
          </span>
        )}
        {testAccount && (
          <button className="btn btn-small btn-primary" onClick={() => connect({ connector: testAccount })} disabled={isPending}>
            Use local test account
          </button>
        )}
      </div>
    );
  }

  if (chainId !== APP_CHAIN.id) {
    return (
      <div className="wallet">
        <span className="pill pill-warn">Wrong network</span>
        <button className="btn btn-small btn-primary" onClick={() => switchChain({ chainId: APP_CHAIN.id })}>
          Switch to {APP_CHAIN.name}
        </button>
      </div>
    );
  }

  async function requestTokens() {
    setFaucet("busy");
    const response = await fetch("/api/faucet", { method: "POST", body: JSON.stringify({ address }) });
    setFaucet(response.ok ? "idle" : "error");
    refetch();
  }

  return (
    <div className="wallet">
      <div className="wallet-chip" title={address}>
        <span className="muted hide-sm">{connector?.type === "mock" ? "Test account" : "Wallet"}</span>
        <span className="mono">{short(address)}</span>
        <span className="wallet-balance" data-testid="balance">{balance !== undefined ? `${pbt(balance)} PBT` : "…"}</span>
        {IS_LOCAL_CHAIN && (
          <button className="btn btn-small" onClick={requestTokens} disabled={faucet === "busy"}>
            {faucet === "busy" ? "Sending…" : faucet === "error" ? "Faucet failed" : "Get test PBT"}
          </button>
        )}
        <button className="btn btn-small" onClick={() => disconnect()}>
          Disconnect
        </button>
      </div>
    </div>
  );
}
